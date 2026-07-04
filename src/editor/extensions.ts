// ─────────────────────────────────────────
// Novels Note JP — CodeMirror Extensions
// ─────────────────────────────────────────

import {
  EditorView,
  ViewPlugin,
  DecorationSet,
  Decoration,
  ViewUpdate,
} from "@codemirror/view";

// ルビ表示 Extension（別ファイルで定義）
export { buildRubyExtension } from "./rubyWidget";
import { RangeSetBuilder, Prec } from "@codemirror/state";
import { App, MarkdownView, TFile } from "obsidian";
import { NovelsNoteSettings } from "../settings";
import { CursorSyncStore } from "./cursorSyncStore";
import {
  TermEntry,
  settingsEffect,
  novelModeField,
  TERM_DRAG_MIME_TYPE,
  bracketRebuildEffect,
  termRebuildEffect,
} from "../types";
import { parseBrackets } from "./bracketParser";

// ─────────────────────────────────────────
// デバウンス再構築のディレイ（ms）
//
// main.ts の用語インデックス再構築（400ms）と同じ考え方。
// カッコ・用語ハイライトは文書全体をスキャンするため、
// 1キー入力ごとに即座に再構築するとタイプ入力がもたつく。
// ─────────────────────────────────────────
const HIGHLIGHT_REBUILD_DELAY = 200;

// ─────────────────────────────────────────
// カッコ・用語ハイライトの再構築を「実際に内容が変わった場合だけ」
// エディタへ反映するためのユーティリティ。
//
// 【背景】
// 以前は 200ms のデバウンス後、常に
//   view.dispatch({ effects: bracketRebuildEffect.of(null) })
// を実行し、update() 内で無条件に this.decorations を
// 作り直していた。しかし文書末尾に追記するような通常の入力では、
// 既存のカッコ・用語の一致範囲はほとんどの場合まったく変化しない
// （新しく完成した組み合わせがなければ、直前の再構築結果と
//   1文字も違わない）。それにもかかわらず、入力が一瞬止まる
// たび（＝通常の日本語入力では非常に高頻度に発生する）に
// 必ず1回、空のトランザクションを dispatch していた。
//
// トランザクションの dispatch は、たとえ内容に変化がなくても
// CodeMirror にビューポート全体の再描画パスを走らせる。これが
// 「入力中ずっとカッコ・用語のハイライトがチカチカする」の
// 直接の原因だった可能性が高い。
//
// 対策として、デバウンス後にまず新しい DecorationSet を
// （dispatch を伴わずに）計算し、直前の結果と実際に異なる場合に
// 限って dispatch するようにした。多くの入力では新しい
// DecorationSet が直前と完全に同一になるため、dispatch 自体が
// 発生しなくなる。
// ─────────────────────────────────────────
// 【重要】RangeSet.eq() はスタンドアロンで使うと期待通りに
// 差分を検出しないことを確認したため（同一内容でも異なる内容でも
// true を返すケースがあった）、確実な手動比較に切り替えている。
// イテレータで両方の RangeSet を並走させ、range（from/to）と
// Decoration.mark の class 名が完全に一致するかを直接比較する。
function decorationsChanged(a: DecorationSet, b: DecorationSet): boolean {
  const ia = a.iter();
  const ib = b.iter();
  while (ia.value && ib.value) {
    if (ia.from !== ib.from || ia.to !== ib.to) return true;
    const specA = (ia.value.spec ?? {}) as { class?: string };
    const specB = (ib.value.spec ?? {}) as { class?: string };
    if (specA.class !== specB.class) return true;
    ia.next();
    ib.next();
  }
  // 両方が終端に達していなければ、要素数が異なる＝変化あり
  return Boolean(ia.value) || Boolean(ib.value);
}

// ─────────────────────────────────────────
// Extension 1: カッコハイライト（最低優先度）
// mode:novel のエディタのみ動作する
// ─────────────────────────────────────────
export function buildBracketExtension(getSettings: () => NovelsNoteSettings) {
  return Prec.lowest(
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        private rebuildTimer: ReturnType<typeof setTimeout> | null = null;

        constructor(view: EditorView) { this.decorations = this.build(view); }

        update(update: ViewUpdate) {
          // 設定変更 → 即座に再構築
          if (
            update.transactions.some(tr => tr.effects.some(e => e.is(settingsEffect)))
          ) {
            this.decorations = this.build(update.view);
            return;
          }
          // scheduleRebuild() 側の dispatch による再描画通知。
          // decorations は dispatch 前に既に最新化済みのため、
          // ここでの再計算は不要（詳細は scheduleRebuild() 参照）。
          if (
            update.transactions.some(tr => tr.effects.some(e => e.is(bracketRebuildEffect)))
          ) {
            return;
          }
          // build() は文書全体をスキャンするため viewportChanged /
          // selectionSet では再構築しない（結果が viewport・選択に
          // 依存しないため、再構築しても無駄な再計算になるだけ）。
          // docChanged のみデバウンスして再構築する（連続入力での
          // 都度フルスキャンを防ぐ）。
          if (update.docChanged) {
            this.scheduleRebuild(update.view);
          }
        }

        private scheduleRebuild(view: EditorView): void {
          if (this.rebuildTimer !== null) window.clearTimeout(this.rebuildTimer);
          this.rebuildTimer = window.setTimeout(() => {
            this.rebuildTimer = null;
            // dispatch する前に新しい DecorationSet を計算し、
            // 実際に変化がある場合だけ dispatch する
            // （詳細は decorationsChanged() 手前のコメント参照）。
            const next = this.build(view);
            if (decorationsChanged(this.decorations, next)) {
              this.decorations = next;
              view.dispatch({ effects: bracketRebuildEffect.of(null) });
            }
          }, HIGHLIGHT_REBUILD_DELAY);
        }

        destroy(): void {
          if (this.rebuildTimer !== null) window.clearTimeout(this.rebuildTimer);
        }

        build(view: EditorView): DecorationSet {
          const builder = new RangeSetBuilder<Decoration>();

          // mode:novel でないエディタでは何もしない
          if (!view.state.field(novelModeField, false)) return builder.finish();

          const settings = getSettings();
          if (!settings.highlightEnabled) return builder.finish();

          const enabledBrackets = settings.bracketDefinitions.filter(b => b.enabled);
          if (enabledBrackets.length === 0) return builder.finish();

          const docText = view.state.doc.toString();
          const matches = parseBrackets(docText, enabledBrackets);

          // 外側（長い）を先に、同じ start なら外側（end が大きい）を先に
          matches.sort((a, b) => a.start - b.start || (b.end - a.end));

          for (const m of matches) {
            builder.add(
              m.start,
              m.end,
              Decoration.mark({
                class: `novel-bracket-${m.id}`,
                inclusive: true,
              })
            );
          }
          return builder.finish();
        }
      },
      { decorations: v => v.decorations }
    )
  );
}

// ─────────────────────────────────────────
// Extension 2: 用語ハイライト（最高優先度）
// mode:novel のエディタのみ動作する
// settingsEffect で確実に再描画される
// ─────────────────────────────────────────
export function buildTermExtension(
  getTerms: () => TermEntry[],
  getSettings: () => NovelsNoteSettings
) {
  return Prec.highest(
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        private rebuildTimer: ReturnType<typeof setTimeout> | null = null;

        constructor(view: EditorView) { this.decorations = this.build(view); }

        update(update: ViewUpdate) {
          // 設定変更（用語インデックス再構築完了の通知を含む）
          // → 即座に再構築
          if (
            update.transactions.some(tr => tr.effects.some(e => e.is(settingsEffect)))
          ) {
            this.decorations = this.build(update.view);
            return;
          }
          // scheduleRebuild() 側の dispatch による再描画通知。
          // decorations は dispatch 前に既に最新化済みのため、
          // ここでの再計算は不要（詳細は buildBracketExtension 内の
          // scheduleRebuild() のコメント参照）。
          if (
            update.transactions.some(tr => tr.effects.some(e => e.is(termRebuildEffect)))
          ) {
            return;
          }
          // build() は文書全体をスキャンするため viewportChanged /
          // selectionSet では再構築しない（結果が viewport・選択に
          // 依存しないため）。docChanged のみデバウンスして再構築する。
          // 用語数が多い Vault ほど build() のコストが大きいため、
          // カッコハイライト以上にデバウンスの効果が大きい。
          if (update.docChanged) {
            this.scheduleRebuild(update.view);
          }
        }

        private scheduleRebuild(view: EditorView): void {
          if (this.rebuildTimer !== null) window.clearTimeout(this.rebuildTimer);
          this.rebuildTimer = window.setTimeout(() => {
            this.rebuildTimer = null;
            // dispatch する前に新しい DecorationSet を計算し、
            // 実際に変化がある場合だけ dispatch する。
            const next = this.build(view);
            if (decorationsChanged(this.decorations, next)) {
              this.decorations = next;
              view.dispatch({ effects: termRebuildEffect.of(null) });
            }
          }, HIGHLIGHT_REBUILD_DELAY);
        }

        destroy(): void {
          if (this.rebuildTimer !== null) window.clearTimeout(this.rebuildTimer);
        }

        build(view: EditorView): DecorationSet {
          const builder = new RangeSetBuilder<Decoration>();

          // mode:novel でないエディタでは何もしない
          if (!view.state.field(novelModeField, false)) return builder.finish();

          const settings = getSettings();
          if (!settings.highlightEnabled) return builder.finish();

          const terms = getTerms();
          if (terms.length === 0) return builder.finish();

          const enabledTags = new Set(
            settings.tagDefinitions.filter(td => td.enabled).map(td => td.tag)
          );

          const searchList: { word: string; cssClass: string }[] = [];
          for (const term of terms) {
            if (!enabledTags.has(term.tag)) continue;
            searchList.push({ word: term.name, cssClass: `novel-hl-${term.tag}` });
            for (const alias of term.aliases) {
              if (alias.trim().length > 0) {
                searchList.push({ word: alias.trim(), cssClass: `novel-hl-${term.tag}` });
              }
            }
          }
          searchList.sort((a, b) => b.word.length - a.word.length);

          const docText = view.state.doc.toString();
          const docLength = docText.length;
          const covered = new Uint8Array(docLength);
          const matches: { start: number; end: number; cssClass: string }[] = [];

          for (const { word, cssClass } of searchList) {
            if (word.length === 0) continue;
            let pos = 0;
            while (pos <= docLength - word.length) {
              const idx = docText.indexOf(word, pos);
              if (idx === -1) break;
              let skip = false;
              for (let i = idx; i < idx + word.length; i++) {
                if (covered[i]) { skip = true; break; }
              }
              if (!skip) {
                matches.push({ start: idx, end: idx + word.length, cssClass });
                for (let i = idx; i < idx + word.length; i++) covered[i] = 1;
              }
              pos = idx + word.length;
            }
          }

          matches.sort((a, b) => a.start - b.start);
          for (const m of matches) {
            builder.add(m.start, m.end, Decoration.mark({
              class: m.cssClass,
              inclusive: false,
            }));
          }
          return builder.finish();
        }
      },
      { decorations: v => v.decorations }
    )
  );
}

// ─────────────────────────────────────────
// Extension 3: 折り返しガイドライン
// mode:novel のエディタのみ動作する
// ─────────────────────────────────────────
export function buildRulerExtension(getSettings: () => NovelsNoteSettings) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) { this.decorations = this.build(view); }
      update(update: ViewUpdate) {
        if (
          update.docChanged ||
          update.viewportChanged ||
          update.transactions.some(tr => tr.effects.some(e => e.is(settingsEffect)))
        ) {
          this.decorations = this.build(update.view);
        }
      }
      build(view: EditorView): DecorationSet {
        const builder = new RangeSetBuilder<Decoration>();

        // mode:novel でないエディタでは何もしない
        if (!view.state.field(novelModeField, false)) return builder.finish();

        const settings = getSettings();
        if (!settings.showRuler) return builder.finish();
        for (const { from, to } of view.visibleRanges) {
          let pos = from;
          while (pos <= to) {
            const line = view.state.doc.lineAt(pos);
            builder.add(
              line.from,
              line.from,
              Decoration.line({ attributes: { class: "novel-ruler-line" } })
            );
            if (line.to >= to) break;
            pos = line.to + 1;
          }
        }
        return builder.finish();
      }
    },
    { decorations: v => v.decorations }
  );
}

// ─────────────────────────────────────────
// Extension 4: 全角スペース可視化
// mode:novel のエディタのみ動作する
// ─────────────────────────────────────────
export function buildFullWidthSpaceExtension(getSettings: () => NovelsNoteSettings) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) { this.decorations = this.build(view); }
      update(update: ViewUpdate) {
        if (
          update.docChanged ||
          update.viewportChanged ||
          update.transactions.some(tr => tr.effects.some(e => e.is(settingsEffect)))
        ) {
          this.decorations = this.build(update.view);
        }
      }
      build(view: EditorView): DecorationSet {
        const builder = new RangeSetBuilder<Decoration>();

        // mode:novel でないエディタでは何もしない
        if (!view.state.field(novelModeField, false)) return builder.finish();

        const settings = getSettings();

        if (!settings.showFullWidthSpace || settings.fullWidthSpaceStyle === "none") {
          return builder.finish();
        }

        // スタイル名を CSS クラス名に含めることで applyEditorStyles と連動
        const styleClass = `novel-fwsp novel-fwsp--${settings.fullWidthSpaceStyle}`;
        const FULL_WIDTH_SPACE = "\u3000";

        const docText = view.state.doc.toString();
        const docLength = docText.length;

        // 可視範囲だけを処理（10万字でも軽量）
        for (const { from, to } of view.visibleRanges) {
          let pos = from;
          while (pos < to && pos < docLength) {
            const idx = docText.indexOf(FULL_WIDTH_SPACE, pos);
            if (idx === -1 || idx >= to) break;
            builder.add(
              idx,
              idx + 1,
              Decoration.mark({ class: styleClass, inclusive: false })
            );
            pos = idx + 1;
          }
        }
        return builder.finish();
      }
    },
    { decorations: v => v.decorations }
  );
}

// ─────────────────────────────────────────
// Extension 5: 用語のドラッグ＆ドロップ挿入
//
// サイドバー（用語インデックス）の用語行をメインエディタへ
// ドラッグ＆ドロップすると、ドロップした正確な位置に
// Wikilink 形式（[[ファイル名]] / [[ファイル名|表示名]]）で挿入する。
//
// ・mode:novel に関係なく、すべてのエディタで動作する
//   （Frontmatter 編集など novel モード以外のノートでも
//   用語間の相互参照リンクを挿入したい場面があるため）
// ・サイドバー内でのフォルダ間移動（既存機能）は dataTransfer の
//   内容を見ずに `this.dragTerm`（インメモリ変数）のみで判定して
//   いるため、ここでカスタム MIME タイプを追加しても無関係。
// ・TERM_DRAG_MIME_TYPE が付いていないドラッグ（エディタ内の
//   テキスト移動や、OS のファイルドロップなど）は素通りさせ、
//   CodeMirror 標準のドロップ処理に委ねる。
// ─────────────────────────────────────────
export function buildTermDropExtension(app: App) {
  return EditorView.domEventHandlers({
    dragover(event, _view) {
      // サイドバー用語のドラッグ以外は何もしない
      if (!event.dataTransfer?.types.includes(TERM_DRAG_MIME_TYPE)) return false;
      // ここで preventDefault しないとブラウザの仕様上 drop イベントが発火しない
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      return true;
    },
    drop(event, view) {
      const raw = event.dataTransfer?.getData(TERM_DRAG_MIME_TYPE);
      if (!raw) return false; // サイドバー用語のドラッグ以外は標準処理に委ねる

      let payload: { filePath: string; name: string };
      try {
        payload = JSON.parse(raw) as { filePath: string; name: string };
      } catch {
        return false;
      }

      const file = app.vault.getAbstractFileByPath(payload.filePath);
      if (!(file instanceof TFile)) return true; // ファイルが見つからない＝何もせず終了

      // ドロップ先エディタが表示しているファイルを特定する
      // （Wikilink の相対パス解決・パス短縮に使うリンク起点）
      // ※ let 変数をコールバック内で再代入する形では、
      //   TypeScript の制御フロー解析が誤って never 型に
      //   絞り込んでしまうため、オブジェクトのプロパティとして保持する
      const sourceFileRef: { file: TFile | null } = { file: null };
      app.workspace.iterateAllLeaves(leaf => {
        if (sourceFileRef.file) return;
        if (leaf.view instanceof MarkdownView) {
          const cm = (leaf.view.editor as unknown as { cm: EditorView | undefined }).cm;
          if (cm === view) sourceFileRef.file = leaf.view.file;
        }
      });

      // Obsidian 標準 API で Wikilink 文字列を生成する。
      // ファイルエクスプローラからのドラッグと同じ仕組みを使うため、
      // 「Wikilink を使う」設定やパス短縮設定もそのまま反映される。
      const linkText = app.fileManager.generateMarkdownLink(
        file,
        sourceFileRef.file?.path ?? "",
        undefined,
        payload.name
      );

      const dropPos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (dropPos == null) return true;

      event.preventDefault();
      view.dispatch({
        changes: { from: dropPos, insert: linkText },
        selection: { anchor: dropPos + linkText.length },
        userEvent: "input.drop",
      });
      view.focus();

      return true;
    },
  });
}

// ─────────────────────────────────────────
// Extension 6: カーソル同期ストアへの書き込み
//
// 縦書きプレビュー（views/verticalPreview.ts）のカーソル文
// ハイライト・スクロール追従のために、「確定した」カーソル位置・
// 選択範囲だけを CursorSyncStore（editor/cursorSyncStore.ts）に
// 書き込む。
//
// 【IME変換中は一切書き込まない】
// compositionstart 〜 compositionend の間は書き込みを止める。
// IME変換は「確定」という明確な区切りがあるため、変換中の
// 文字数変化のたびに書き込んでいた以前の実装（縦書きプレビュー側の
// ポーリング）とは異なり、ここでは変換が終わるまで縦書き
// プレビュー側には一切通知されない。
//
// 【変換中でなくても少しだけデバウンスする】
// 矢印キーでの連続移動や高速な非IME入力でも書き込みが
// 過剰にならないよう、CURSOR_SYNC_SETTLE_MS だけ短く安定を
// 待ってから書き込む。IME変換の確定直後も、CM6内部のドキュメント
// 更新が同一フレームで反映されない場合があるため、同じ仕組みで
// 少し待ってから書き込む。
// ─────────────────────────────────────────
const CURSOR_SYNC_SETTLE_MS = 150;

export function buildCursorSyncExtension(store: CursorSyncStore, app: App) {
  // ドロップ処理（buildTermDropExtension）と同じ方法で、
  // 対象 EditorView に対応する Obsidian 側の TFile を特定する
  const findFile = (view: EditorView): TFile | null => {
    const ref: { file: TFile | null } = { file: null };
    app.workspace.iterateAllLeaves(leaf => {
      if (ref.file) return;
      if (leaf.view instanceof MarkdownView) {
        const cm = (leaf.view.editor as unknown as { cm: EditorView | undefined }).cm;
        if (cm === view) ref.file = leaf.view.file;
      }
    });
    return ref.file;
  };

  const commit = (view: EditorView): void => {
    const range = view.state.selection.main;
    const line  = view.state.doc.lineAt(range.head);
    store.set({
      file:      findFile(view),
      line:      line.number - 1, // CM6 は1始まり、Obsidian editor / 本プラグイン内部は0始まり
      ch:        range.head - line.from,
      selection: view.state.sliceDoc(range.from, range.to),
      text:      view.state.doc.toString(),
    });
  };

  class CursorSyncPlugin {
    composing = false;
    settleTimer: ReturnType<typeof setTimeout> | null = null;

    scheduleCommit(view: EditorView): void {
      if (this.composing) return;
      if (this.settleTimer !== null) window.clearTimeout(this.settleTimer);
      this.settleTimer = window.setTimeout(() => {
        this.settleTimer = null;
        commit(view);
      }, CURSOR_SYNC_SETTLE_MS);
    }

    update(update: ViewUpdate): void {
      if (!update.selectionSet && !update.docChanged) return;
      this.scheduleCommit(update.view);
    }

    destroy(): void {
      if (this.settleTimer !== null) window.clearTimeout(this.settleTimer);
    }
  }

  return ViewPlugin.fromClass(CursorSyncPlugin, {
    eventHandlers: {
      // IME変換開始：進行中の書き込み予約をすべてキャンセルする
      compositionstart(_event, _view) {
        this.composing = true;
        if (this.settleTimer !== null) {
          window.clearTimeout(this.settleTimer);
          this.settleTimer = null;
        }
      },
      // IME変換確定：ここで初めて（少し待ってから）反映する
      compositionend(_event, view) {
        this.composing = false;
        this.scheduleCommit(view);
      },
    },
  });
}
