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
import { RangeSetBuilder, Prec } from "@codemirror/state";
import { App, MarkdownView, TFile } from "obsidian";
import { NovelsNoteSettings } from "./settings";
import { TermEntry, settingsEffect, novelModeField, TERM_DRAG_MIME_TYPE } from "./types";
import { parseBrackets } from "./bracketParser";

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
          if (
            update.docChanged ||
            update.viewportChanged ||
            update.selectionSet ||
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
        constructor(view: EditorView) { this.decorations = this.build(view); }
        update(update: ViewUpdate) {
          if (
            update.docChanged ||
            update.viewportChanged ||
            update.selectionSet ||
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
// サイドバー（タグ情報一覧）の用語行をメインエディタへ
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
        payload = JSON.parse(raw);
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
          const cm = (leaf.view.editor as any).cm as EditorView | undefined;
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
