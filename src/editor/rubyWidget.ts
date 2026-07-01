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
import { NovelsNoteSettings } from "../settings";
import { settingsEffect, novelModeField } from "../types";
import { findRubyMatches, RubyMatch } from "../core/rubyPatterns";

// ─────────────────────────────────────────
// ルビウィジェット
// ─────────────────────────────────────────
class RubyWidget extends WidgetType {
  constructor(
    readonly base: string,
    readonly ruby: string
  ) {
    super();
  }

  eq(other: RubyWidget): boolean {
    return this.base === other.base && this.ruby === other.ruby;
  }

  toDOM(): HTMLElement {
    const rubyEl = window.document.createElement("ruby");
    rubyEl.className = "nn-editor-ruby";
    rubyEl.appendChild(window.document.createTextNode(this.base));
    const rt = window.document.createElement("rt");
    rt.textContent = this.ruby;
    rubyEl.appendChild(rt);
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
export function buildRubyExtension(getSettings: () => NovelsNoteSettings) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = this.build(view);
      }

      update(update: ViewUpdate) {
        if (
          update.docChanged ||
          update.viewportChanged ||
          update.selectionSet ||
          update.transactions.some(tr =>
            tr.effects.some(e => e.is(settingsEffect))
          )
        ) {
          this.decorations = this.build(update.view);
        }
      }

      build(view: EditorView): DecorationSet {
        const builder = new RangeSetBuilder<Decoration>();

        // mode:novel 以外では何もしない
        if (!view.state.field(novelModeField, false)) return builder.finish();

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
          builder.add(
            m.from,
            m.to,
            Decoration.replace({
              widget: new RubyWidget(m.base, m.ruby),
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
