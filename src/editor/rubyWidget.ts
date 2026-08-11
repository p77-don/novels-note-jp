// ─────────────────────────────────────────
// Novels Note JP — エディタ内ルビ表示
//
// mode:novel のエディタ上でルビ記法をインライン描画する。
// カーソルが親文字範囲に接触しているときは生テキストに戻す。
// ─────────────────────────────────────────

import {
  EditorView,
  ViewPlugin,
  DecorationSet,
  Decoration,
  WidgetType,
  ViewUpdate,
} from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import { editorLivePreviewField } from "obsidian";
import { NovelsNoteSettings } from "../settings";
import { settingsEffect, novelModeField, TermEntry } from "../types";
import { findRubyMatches, RubyMatch, computeRtFontSizeEm, DEFAULT_RT_FONT_SIZE_EM } from "../core/rubyPatterns";
import { findTermMatches, TermMatch } from "../core/termMatcher";

// ─────────────────────────────────────────
// ルビウィジェット
//
// ルビ構文全体（親文字＋ルビ記号＋ルビ文字）を Decoration.replace で
// 丸ごと置き換えて描画するため、置き換え前の親文字に付いていた
// 用語ハイライトの Decoration.mark はそのままでは失われてしまう
// （置換後のDOMは本ウィジェットが新規に作るため）。
// そのため、親文字が用語ハイライト対象である場合は、呼び出し側
// （buildRubyExtension）で判定した highlightClass をこのウィジェットに
// 渡し、ここで改めて親文字部分に同じCSSクラスを適用する。
// ─────────────────────────────────────────
class RubyWidget extends WidgetType {
  constructor(
    readonly base: string,
    readonly ruby: string,
    readonly highlightClass: string | null
  ) {
    super();
  }

  eq(other: RubyWidget): boolean {
    return this.base === other.base &&
      this.ruby === other.ruby &&
      this.highlightClass === other.highlightClass;
  }

  toDOM(): HTMLElement {
    const rubyEl = createEl("ruby", { cls: "nn-editor-ruby" });
    if (this.highlightClass) {
      // 用語ハイライト対象の親文字：本文側と同じクラスを付けた
      // <span> で包み、色付けを引き継ぐ（本文側は
      // main.ts の applyEditorStyles() が注入する
      // `.cm-content .novel-hl-xxx` セレクタで色指定されており、
      // このウィジェットのDOMも .cm-content の子孫になるため、
      // 同じクラスを付けるだけで同一のスタイルが適用される）。
      rubyEl.createSpan({ cls: this.highlightClass, text: this.base });
    } else {
      rubyEl.appendText(this.base);
    }
    const rt = rubyEl.createEl("rt", { text: this.ruby });
    // ルビ文字数が親文字数に対して極端に多い場合のみ、
    // font-size を縮小して折り返しズレを防ぐ
    // （詳細は core/rubyPatterns.ts の computeRtFontSizeEm() を参照）
    const fontSizeEm = computeRtFontSizeEm(this.base, this.ruby);
    if (fontSizeEm !== DEFAULT_RT_FONT_SIZE_EM) {
      rt.setCssStyles({ fontSize: `${fontSizeEm}em` });
    }
    return rubyEl;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

// ─────────────────────────────────────────
// ルビ構文の検出
//
// 検出ロジックは core/rubyPatterns.ts に集約されている
// （Export・縦書きプレビュー・小説閲覧ビューと検出基準・CJK文字範囲
//   （拡張漢字 \u{20000}-\u{3FFFF} 含む）を統一するため）。
// ─────────────────────────────────────────

// ─────────────────────────────────────────
// ViewPlugin 本体
// ─────────────────────────────────────────
export function buildRubyExtension(
  getSettings: () => NovelsNoteSettings,
  getTerms: () => TermEntry[]
) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = this.build(view);
      }

      update(update: ViewUpdate) {
        try {
          if (
            update.docChanged ||
            update.viewportChanged ||
            update.selectionSet ||
            update.transactions.some(tr =>
              tr.effects.some(e => e.is(settingsEffect))
            ) ||
            // ソースモード ⇔ ライブプレビューの切り替えでも再構築する
            // （切り替え自体は docChanged 等を伴わないため、この判定が
            //   ないとモード切替直後は古い描画のままになる）
            update.startState.field(editorLivePreviewField, false) !==
              update.state.field(editorLivePreviewField, false)
          ) {
            this.decorations = this.build(update.view);
          }
        } catch (e) {
          console.error("[Novels Note JP] ルビ表示の更新でエラーが発生しました。", e);
        }
      }

      build(view: EditorView): DecorationSet {
        const builder = new RangeSetBuilder<Decoration>();

        // mode:novel 以外では何もしない
        if (!view.state.field(novelModeField, false)) return builder.finish();

        // ソースモードでは記入内容をそのまま表示する（ルビ記法を
        // 生テキストのまま見せる）ため、ウィジェット置換を行わない。
        // ライブプレビューでのみルビ表示を有効にする。
        if (!view.state.field(editorLivePreviewField, false)) return builder.finish();

        const settings = getSettings();
        const style = settings.rubyStyle;

        // カーソル位置の集合（全選択範囲のヘッド/アンカー）
        const cursorPositions = new Set<number>();
        const ranges: { from: number; to: number }[] = [];
        for (const range of view.state.selection.ranges) {
          // 選択がある場合は範囲内全体をカバー
          if (range.from !== range.to) {
            ranges.push({ from: range.from, to: range.to });
          }
          cursorPositions.add(range.head);
          cursorPositions.add(range.anchor);
        }

        const docText = view.state.doc.toString();

        // 用語ハイライトとの重なり判定用データ（本文全体が対象）。
        // ルビの親文字範囲がここに含まれる場合、ウィジェット側にも
        // 同じCSSクラスを渡して色付けを引き継ぐ（クラス自体の定義や
        // 有効/無効判定は buildTermExtension と共通の findTermMatches()
        // に委ねているため、判定基準が二重管理でずれる心配はない）。
        const terms = getTerms();
        const termMatches: TermMatch[] =
          settings.highlightEnabled && terms.length > 0
            ? findTermMatches(docText, terms, settings)
            : [];

        const findHighlightClass = (baseFrom: number, baseTo: number): string | null => {
          for (const t of termMatches) {
            if (t.start < baseTo && t.end > baseFrom) return t.cssClass;
          }
          return null;
        };

        const allMatches: RubyMatch[] = [];

        // 可視範囲のみ処理する（パフォーマンス）
        for (const { from: vFrom, to: vTo } of view.visibleRanges) {
          // 可視範囲を少し広げてスクロール境界での欠けを防ぐ
          const scanFrom = Math.max(0, vFrom - 200);
          const scanTo = Math.min(docText.length, vTo + 200);
          const slice = docText.slice(scanFrom, scanTo);
          const sliceMatches = findRubyMatches(slice, style);
          for (const m of sliceMatches) {
            allMatches.push({
              from: m.from + scanFrom,
              to: m.to + scanFrom,
              baseFrom: m.baseFrom + scanFrom,
              baseTo: m.baseTo + scanFrom,
              base: m.base,
              ruby: m.ruby,
            });
          }
        }

        // 重複排除（スキャン範囲のオーバーラップで同じマッチが2回入る可能性）
        const seen = new Set<number>();
        const unique = allMatches.filter(m => {
          if (seen.has(m.from)) return false;
          seen.add(m.from);
          return true;
        });

        unique.sort((a, b) => a.from - b.from);

        for (const m of unique) {
          // カーソルが構文全体（親文字＋ルビ記号＋ルビ文字）に「接触」しているとき → raw テキスト表示
          // 「接触」 = カーソル位置が [from, to] の閉区間内
          const cursorTouches =
            // 点カーソル
            [...cursorPositions].some(p => p >= m.from && p <= m.to) ||
            // 範囲選択が構文全体にオーバーラップ
            ranges.some(r => r.from < m.to && r.to > m.from);

          if (cursorTouches) continue;

          // 構文全体を WidgetType で置換する
          const highlightClass = findHighlightClass(m.baseFrom, m.baseTo);
          builder.add(
            m.from,
            m.to,
            Decoration.replace({
              widget: new RubyWidget(m.base, m.ruby, highlightClass),
              inclusive: false,
            })
          );
        }

        return builder.finish();
      }
    },
    { decorations: v => v.decorations }
  );
}
