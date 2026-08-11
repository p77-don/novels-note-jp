// ─────────────────────────────────────────
// Novels Note JP — CodeMirror Extensions
// ─────────────────────────────────────────

import {
  EditorView,
  ViewPlugin,
  DecorationSet,
  Decoration,
  ViewUpdate,
  WidgetType,
} from "@codemirror/view";

// ルビ表示 Extension（別ファイルで定義）
export { buildRubyExtension } from "./rubyWidget";
import { RangeSetBuilder, Prec } from "@codemirror/state";
import { App, MarkdownView, TFile, HoverParent, HoverPopover, Platform } from "obsidian";
import { NovelsNoteSettings } from "../settings";
import { CursorSyncStore } from "./cursorSyncStore";
import {
  TermEntry,
  settingsEffect,
  novelModeField,
  TERM_DRAG_MIME_TYPE,
} from "../types";
import { parseBrackets } from "./bracketParser";
import { findTermMatches } from "../core/termMatcher";

// ─────────────────────────────────────────
// Extension 1: カッコハイライト（最低優先度）
// mode:novel のエディタのみ動作する
// ─────────────────────────────────────────
export function buildBracketExtension(getSettings: () => NovelsNoteSettings) {
  return Prec.lowest(
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;

        constructor(view: EditorView) { this.decorations = this.build(view); }

        update(update: ViewUpdate) {
          // v0.6.4 と同じ同期方式に戻した（詳細は下記コメント参照）。
          //
          // 【経緯】0.6.5 で「文書全体スキャンのコストを避けるため」
          // docChanged を200msデバウンスし、別トランザクションで
          // dispatch する方式に変更したが、これにより「入力した瞬間は
          // 古いハイライトのまま表示され、ワンテンポ遅れてハイライトが
          // 切り替わる」状態になり、日本語入力（IME変換のたびに
          // docChanged が高頻度発生する）で顕著な「ちらつき」として
          // 体感される原因になっていた。
          // dispatch を実際に内容が変わった場合だけに絞る改善を
          // 挟んでも、遅延そのもの（ワンテンポ遅れる感覚）は
          // 解消されなかったため、根本原因である非同期化を撤回し、
          // 0.6.4 時点の「同じ update() サイクル内で同期的に
          // 再構築する」方式に戻す。
          //
          // try/catch で保護する理由：CM6は ViewPlugin.update() 内で
          // 例外が発生すると、そのプラグインインスタンスを永久に
          // 無効化する仕様がある（Obsidian 1.13系でのCodeMirror
          // アップグレードに伴う内部レンダラの大幅な書き換えにより、
          // 稀なケースでの例外発生パターンが変わる可能性があるため、
          // 念のための保険として追加）。
          try {
            if (
              update.docChanged ||
              update.viewportChanged ||
              update.selectionSet ||
              update.transactions.some(tr => tr.effects.some(e => e.is(settingsEffect)))
            ) {
              this.decorations = this.build(update.view);
            }
          } catch (e) {
            console.error("[Novels Note JP] 括弧強調の更新でエラーが発生しました。", e);
          }
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
// 用語ホバープレビューの hover-link source id
// main.ts の registerHoverLinkSource() と一致させる必要がある
// ─────────────────────────────────────────
export const TERM_HOVER_SOURCE_ID = "novels-note-jp-term-hover";

// ─────────────────────────────────────────
// Extension 2: 用語ハイライト（最高優先度）
// mode:novel のエディタのみ動作する
// settingsEffect で確実に再描画される
//
// あわせて、ハイライトされた用語にマウスをホバーすると、対応する
// 用語ノートを Obsidian 標準の Hover Preview（Page Preview）で
// 表示する機能を提供する。
//
// 【設計方針】
// WikiLink を書かなくても、既存の用語ハイライト（インデックス上の
// 用語名・エイリアスと本文の一致）だけをトリガーにする。これは
// 「Markdownは純粋な文章のまま保ち、知識管理はプラグインが
// 肩代わりする」という本プラグインの思想に基づく。
//
// 【Obsidian 標準 Hover Preview の流用】
// 独自の Popover を実装せず、`app.workspace.trigger("hover-link", …)`
// で core の Page Preview プラグインに委譲する。これにより
// ユーザーの「Page Preview」設定（表示遅延など）や、ピン留め・
// Esc で閉じる等の挙動がそのまま反映される。
// ─────────────────────────────────────────
export function buildTermExtension(
  app: App,
  getTerms: () => TermEntry[],
  getSettings: () => NovelsNoteSettings
) {
  return Prec.highest(
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        // build() のたびに再計算する、ホバー判定用の生データ。
        // Decoration（CM6内部表現）から逆引きするより、開始・終了
        // 位置と用語ノートのファイルパスを直接保持する方が単純。
        matches: { start: number; end: number; filePath: string }[] = [];
        // 直前にホバー通知を送った対象要素（同一要素への
        // mousemove の連続発火で何度も trigger しないようにする）
        hoverTarget: HTMLElement | null = null;
        // Page Preview 側が Popover の表示状態を追跡するための
        // 入れ物。HoverParent インターフェースを満たすだけの
        // 単純なオブジェクトで、Component のライフサイクルには
        // 依存しない。
        hoverParent: HoverParent = { hoverPopover: null as HoverPopover | null };

        constructor(view: EditorView) { this.decorations = this.build(view); }

        update(update: ViewUpdate) {
          // v0.6.4 と同じ同期方式に戻した。
          // 経緯は buildBracketExtension 内の update() コメントを参照。
          try {
            if (
              update.docChanged ||
              update.viewportChanged ||
              update.selectionSet ||
              update.transactions.some(tr => tr.effects.some(e => e.is(settingsEffect)))
            ) {
              this.decorations = this.build(update.view);
            }
          } catch (e) {
            console.error("[Novels Note JP] 用語ハイライトの更新でエラーが発生しました。", e);
          }
        }

        build(view: EditorView): DecorationSet {
          const builder = new RangeSetBuilder<Decoration>();
          this.matches = [];

          // mode:novel でないエディタでは何もしない
          if (!view.state.field(novelModeField, false)) return builder.finish();

          const settings = getSettings();
          if (!settings.highlightEnabled) return builder.finish();

          const terms = getTerms();
          if (terms.length === 0) return builder.finish();

          const docText = view.state.doc.toString();
          const matches = findTermMatches(docText, terms, settings);

          for (const m of matches) {
            builder.add(m.start, m.end, Decoration.mark({
              class: m.cssClass,
              inclusive: false,
            }));
            this.matches.push({ start: m.start, end: m.end, filePath: m.filePath });
          }
          return builder.finish();
        }
      },
      {
        decorations: v => v.decorations,
        eventHandlers: {
          mouseover(event, view) {
            // モバイルには物理マウスのホバーという概念がなく、
            // タッチ環境でこのイベントが意図せず発火すると
            // ポップオーバーが誤表示される可能性があるため無効化する。
            // 代替として「選択した文字列の用語ノートを開く」コマンドがある。
            if (Platform.isMobile) return false;
            if (!getSettings().termHoverPreviewEnabled) return false;
            if (!view.state.field(novelModeField, false)) return false;

            const targetEl = (event.target as HTMLElement | null)?.closest?.(
              '[class*="novel-hl-"]'
            ) as HTMLElement | null;
            if (!targetEl) return false;
            // 同じ要素上でのマウス移動では再通知しない
            if (targetEl === this.hoverTarget) return false;
            this.hoverTarget = targetEl;

            let pos: number;
            try {
              pos = view.posAtDOM(targetEl);
            } catch {
              return false;
            }

            const match = this.matches.find(m => pos >= m.start && pos < m.end);
            if (!match) return false;

            const file = app.vault.getAbstractFileByPath(match.filePath);
            if (!(file instanceof TFile)) return false;

            // ホバー中のエディタが表示しているファイルパスを
            // sourcePath として渡す（相対リンク解決等に使われる）
            const sourceRef: { file: TFile | null } = { file: null };
            app.workspace.iterateAllLeaves(leaf => {
              if (sourceRef.file) return;
              if (leaf.view instanceof MarkdownView) {
                const cm = (leaf.view.editor as unknown as { cm: EditorView | undefined }).cm;
                if (cm === view) sourceRef.file = leaf.view.file;
              }
            });

            app.workspace.trigger("hover-link", {
              event,
              source: TERM_HOVER_SOURCE_ID,
              hoverParent: this.hoverParent,
              targetEl,
              linktext: match.filePath,
              sourcePath: sourceRef.file?.path ?? "",
            });
            return false;
          },
          mouseout(event) {
            // ホバー対象要素（およびその子孫、= Popover 自身への
            // 移動ではない）から完全に離れた場合だけ記録をクリアする。
            // Popover の表示・非表示自体は Page Preview 側が管理する。
            const related = event.relatedTarget as Node | null;
            if (this.hoverTarget && (!related || !this.hoverTarget.contains(related))) {
              this.hoverTarget = null;
            }
            return false;
          },
        },
      }
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
        try {
          if (
            update.docChanged ||
            update.viewportChanged ||
            update.transactions.some(tr => tr.effects.some(e => e.is(settingsEffect)))
          ) {
            this.decorations = this.build(update.view);
          }
        } catch (e) {
          console.error("[Novels Note JP] 折り返しガイドラインの更新でエラーが発生しました。", e);
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
        try {
          if (
            update.docChanged ||
            update.viewportChanged ||
            update.transactions.some(tr => tr.effects.some(e => e.is(settingsEffect)))
          ) {
            this.decorations = this.build(update.view);
          }
        } catch (e) {
          console.error("[Novels Note JP] 全角スペース可視化の更新でエラーが発生しました。", e);
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
// Extension 4.5: 改行記号可視化
// mode:novel のエディタのみ動作する
//
// 【折り返しへの影響について】
// 実際に文字を挿入する（Decoration.replace など）方式だと、記号の
// 分だけ幅が増え、折り返し境界ぎりぎりの行では記号だけが次行に
// 押し出されてしまう可能性がある。
// これを避けるため、記号本体はレイアウト幅を持たない
// width:0 の inline-block ラッパー（Decoration.widget）に収め、
// 見た目の記号は position:absolute の子要素として重ねて描画する
// （全角スペース可視化の ::after オーバーレイと同じ考え方）。
// ラッパー自体の幅が 0 のため、折り返し判定に影響を与えない。
// ─────────────────────────────────────────
class EolWidget extends WidgetType {
  eq(): boolean {
    // どの行の改行記号も見た目・状態は同一なので、常に等価として
    // 扱い、無駄な DOM 再生成を避ける。
    return true;
  }

  toDOM(): HTMLElement {
    const wrap = createSpan({ cls: "novel-eol", attr: { "aria-hidden": "true" } });
    wrap.createSpan({ cls: "novel-eol-mark", text: "↵" });
    return wrap;
  }

  ignoreEvent(): boolean {
    // クリック等はエディタ本体に委ね、記号自体はカーソル操作に
    // 割り込まない。
    return true;
  }
}

export function buildEolMarkerExtension(getSettings: () => NovelsNoteSettings) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) { this.decorations = this.build(view); }
      update(update: ViewUpdate) {
        try {
          if (
            update.docChanged ||
            update.viewportChanged ||
            update.transactions.some(tr => tr.effects.some(e => e.is(settingsEffect)))
          ) {
            this.decorations = this.build(update.view);
          }
        } catch (e) {
          console.error("[Novels Note JP] 行末マーカーの更新でエラーが発生しました。", e);
        }
      }
      build(view: EditorView): DecorationSet {
        const builder = new RangeSetBuilder<Decoration>();

        // mode:novel でないエディタでは何もしない
        if (!view.state.field(novelModeField, false)) return builder.finish();

        const settings = getSettings();

        // 全角スペース可視化と表示条件・トグルを共有する
        // （全角スペースを非表示にした場合は改行記号も非表示にする）。
        if (!settings.showFullWidthSpace || settings.fullWidthSpaceStyle === "none") {
          return builder.finish();
        }

        const widget = Decoration.widget({ widget: new EolWidget(), side: 1 });
        const doc = view.state.doc;
        const lastLine = doc.lines;

        for (const { from, to } of view.visibleRanges) {
          let pos = from;
          while (pos <= to) {
            const line = doc.lineAt(pos);
            // 文書の最終行には改行が存在しないため記号を出さない
            if (line.number < lastLine) {
              builder.add(line.to, line.to, widget);
            }
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
      try {
        if (!update.selectionSet && !update.docChanged) return;
        this.scheduleCommit(update.view);
      } catch (e) {
        console.error("[Novels Note JP] カーソル同期の更新でエラーが発生しました。", e);
      }
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
