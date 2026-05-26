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
import { NovelsNoteSettings } from "./settings";
import { TermEntry, settingsEffect } from "./types";
import { parseBrackets } from "./bracketParser";

// ─────────────────────────────────────────
// Extension 1: カッコハイライト（最低優先度）
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
//
// 【方針】
// 全角スペース（U+3000）は色を変えても視覚的に変わらない。
// Decoration.mark で専用クラスを当て、CSS の ::after 擬似要素で
// 「スペースの上に可視記号を重ねる」ことで本文を変えずに表示する。
//
// position: relative → ::after で絶対配置して文字の中心にマーカーを置く。
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
