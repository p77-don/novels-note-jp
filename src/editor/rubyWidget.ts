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
import { NovelsNoteSettings, RubyStyle } from "../settings";
import { settingsEffect, novelModeField } from "../types";

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
    const rubyEl = document.createElement("ruby");
    rubyEl.className = "nn-editor-ruby";
    rubyEl.appendChild(document.createTextNode(this.base));
    const rt = document.createElement("rt");
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
// ─────────────────────────────────────────
interface RubyMatch {
  from: number;   // 構文全体の開始（縦棒を含む）
  to: number;     // 構文全体の終了
  baseFrom: number; // 親文字の開始
  baseTo: number;   // 親文字の終了
  base: string;
  ruby: string;
}

const CJK = "\u3005\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF";

/**
 * テキスト内のルビ記法をすべて検出してリストで返す。
 * rubyStyle の設定に応じてパターンを切り替える。
 */
export function findRubyMatches(text: string, style: RubyStyle): RubyMatch[] {
  const matches: RubyMatch[] = [];

  switch (style) {
    case "narou":
    case "aozora": {
      // パターン1: [|｜]base《ruby》  ← 縦棒あり（任意文字列）
      // パターン2: CJK+《ruby》       ← 縦棒なし（漢字のみ）
      const re = new RegExp(
        "[|｜]([^\u300A\n]+)\u300A([^\u300B\n]*)\u300B" +
        "|([" + CJK + "]+)\u300A([^\u300B\n]*)\u300B",
        "g"
      );
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const hasBar = m[1] !== undefined;
        const base = hasBar ? m[1] : m[3];
        const ruby = hasBar ? m[2] : m[4];
        const from = m.index;
        const to = from + m[0].length;
        // 親文字の開始位置（縦棒があれば +1）
        const baseFrom = hasBar ? from + 1 : from;
        const baseTo = baseFrom + base.length;
        matches.push({ from, to, baseFrom, baseTo, base, ruby });
      }
      break;
    }

    case "denden": {
      // {base|ruby}
      const re = /\{([^|\n]+)\|([^}\n]+)\}/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const base = m[1];
        const ruby = m[2];
        const from = m.index;
        const to = from + m[0].length;
        const baseFrom = from + 1; // "{" の次
        const baseTo = baseFrom + base.length;
        matches.push({ from, to, baseFrom, baseTo, base, ruby });
      }
      break;
    }

    case "html": {
      // <ruby>base<rt>ruby</rt></ruby>
      const re = /<ruby>\s*([^<]+?)\s*<rt>\s*([^<]*?)\s*<\/rt>\s*<\/ruby>/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const base = m[1];
        const ruby = m[2];
        const from = m.index;
        const to = from + m[0].length;
        // <ruby> は7文字
        const baseFrom = from + 6;
        const baseTo = baseFrom + base.length;
        matches.push({ from, to, baseFrom, baseTo, base, ruby });
      }
      break;
    }
  }

  return matches;
}

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
