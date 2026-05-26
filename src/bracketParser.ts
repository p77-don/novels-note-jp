// ─────────────────────────────────────────
// Novels Note JP — カッコ解析
// ─────────────────────────────────────────

import { BracketDefinition } from "./settings";
import { BracketMatch } from "./types";

/**
 * テキスト全体からカッコの対応範囲を解析する。
 * ネストに対応したスタックベース実装。
 */
export function parseBrackets(
  docText: string,
  enabledBrackets: BracketDefinition[]
): BracketMatch[] {
  const results: BracketMatch[] = [];
  if (enabledBrackets.length === 0) return results;

  type Token = { pos: number; type: "open" | "close"; id: string; len: number };
  const tokens: Token[] = [];

  for (const bd of enabledBrackets) {
    let pos = 0;
    while (pos < docText.length) {
      const idx = docText.indexOf(bd.open, pos);
      if (idx === -1) break;
      tokens.push({ pos: idx, type: "open", id: bd.id, len: bd.open.length });
      pos = idx + bd.open.length;
    }
    pos = 0;
    while (pos < docText.length) {
      const idx = docText.indexOf(bd.close, pos);
      if (idx === -1) break;
      tokens.push({ pos: idx, type: "close", id: bd.id, len: bd.close.length });
      pos = idx + bd.close.length;
    }
  }

  tokens.sort((a, b) => a.pos - b.pos || (a.type === "open" ? -1 : 1));

  const stacks = new Map<string, number[]>();
  for (const bd of enabledBrackets) stacks.set(bd.id, []);

  const bdMap = new Map<string, BracketDefinition>();
  for (const bd of enabledBrackets) bdMap.set(bd.id, bd);

  for (const token of tokens) {
    const stack = stacks.get(token.id);
    if (!stack) continue;
    const bd = bdMap.get(token.id);
    if (!bd) continue;

    if (token.type === "open") {
      stack.push(token.pos);
    } else {
      if (stack.length > 0) {
        const openPos = stack.pop()!;
        const end = token.pos + bd.close.length;
        results.push({ start: openPos, end, id: token.id });
      }
    }
  }

  return results;
}
