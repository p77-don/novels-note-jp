// ─────────────────────────────────────────
// CSS Custom Highlight API 型定義の補完
//
// TypeScript の lib.dom.d.ts には Highlight / HighlightRegistry /
// CSS.highlights 自体はすでに宣言されているが、これらは WebIDL の
// setlike<>／maplike<> 注釈に対応する add / delete / clear / has /
// set などの実メソッドを欠いた不完全な定義になっている
// （TypeScript の DOM 型生成側の既知の制約）。
//
// そのため、ここでは Highlight / CSS.highlights 自体を再宣言せず、
// 既存の interface に不足しているメンバーだけを
// 宣言マージ（declaration merging）で補う。
//
// 対応状況: Chrome/Edge 105+, Safari 17.2+
// （Obsidian Desktop が使う Electron の Chromium は
//   1.8系時点で 130 台のため、問題なく利用可能）
// https://developer.mozilla.org/en-US/docs/Web/API/CSS_Custom_Highlight_API
// ─────────────────────────────────────────

export {};

declare global {
  interface Highlight {
    add(range: AbstractRange): Highlight;
    delete(range: AbstractRange): boolean;
    clear(): void;
    has(range: AbstractRange): boolean;
    readonly size: number;
  }

  interface HighlightRegistry {
    set(name: string, highlight: Highlight): HighlightRegistry;
    delete(name: string): boolean;
    clear(): void;
    has(name: string): boolean;
  }
}
