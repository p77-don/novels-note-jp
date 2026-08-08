// ─────────────────────────────────────────
// Novels Note JP — 用語ツリー共有ロジック
//
// 「用語ノートかどうかの判定」「フォルダ階層ツリーの構築」は
// サイドバー（views/sidebarView.ts）と用語入力パレット
// （editor/glossaryPalette.ts, views/glossaryPaletteView.ts）の
// 両方から参照される。判定基準がモジュールごとに分岐すると
// サイドバーと入力パレットで「用語ノートとして扱われるファイル」が
// ズレるバグの温床になるため、ここに一本化する。
// ─────────────────────────────────────────

import { TermEntry } from "../types";
import { TagDefinition } from "../settings";

// ─────────────────────────────────────────
// 用語ノート判定
// ─────────────────────────────────────────

/**
 * frontmatter の tags を tagDefinitions と照合し、
 * 一致した最初のタグ（= 用語ノートのカテゴリ）を返す。
 * 一致しなければ null（＝用語ノートではない）。
 *
 * main.ts の buildTermIndex() と、用語入力パレットの
 * 「起動範囲：原稿ノート＋用語ノート」判定の両方から呼ばれる。
 */
export function matchTermTag(
  frontmatter: Record<string, unknown> | undefined | null,
  tagDefinitions: TagDefinition[]
): string | null {
  if (!frontmatter) return null;

  const validTags = new Set(tagDefinitions.map(td => td.tag));

  let tags: string[] = [];
  const rawTags = frontmatter.tags;
  if (Array.isArray(rawTags)) {
    tags = rawTags.map((t: unknown) => String(t).replace(/^#/, ""));
  } else if (typeof rawTags === "string") {
    tags = [rawTags.replace(/^#/, "")];
  }

  return tags.find(t => validTags.has(t)) ?? null;
}

// ─────────────────────────────────────────
// フォルダ階層ツリー
// ─────────────────────────────────────────
export interface FolderNode {
  name: string;        // フォルダ表示名（最後のセグメント）
  fullPath: string;    // "characters/heroes" など
  children: FolderNode[];
  terms: TermEntry[];
}

/** filePath からフォルダパスを返す（ファイル名を除く）
 *  例: "characters/hero/alice.md" → "characters/hero"
 *      "alice.md"                 → ""（ルート）
 */
export function folderOf(filePath: string): string {
  const idx = filePath.lastIndexOf("/");
  return idx === -1 ? "" : filePath.substring(0, idx);
}

/**
 * TermEntry[] をフォルダ階層ツリーに変換する。
 */
export function buildFolderTree(terms: TermEntry[]): FolderNode {
  const root: FolderNode = { name: "", fullPath: "", children: [], terms: [] };

  for (const term of terms) {
    const folder = folderOf(term.filePath);
    const segments = folder === "" ? [] : folder.split("/");
    insertTerm(root, segments, term);
  }

  return root;
}

function insertTerm(
  node: FolderNode,
  segments: string[],
  term: TermEntry
): void {
  if (segments.length === 0) {
    node.terms.push(term);
    return;
  }
  const [head, ...rest] = segments;
  let child = node.children.find(c => c.name === head);
  if (!child) {
    child = {
      name: head,
      fullPath: node.fullPath === "" ? head : `${node.fullPath}/${head}`,
      children: [],
      terms: [],
    };
    node.children.push(child);
  }
  insertTerm(child, rest, term);
}

/** ツリーをソート（フォルダ名・用語名ともに昇順） */
export function sortTree(node: FolderNode): void {
  node.children.sort((a, b) => a.name.localeCompare(b.name, "ja"));
  node.terms.sort((a, b) => a.name.localeCompare(b.name, "ja"));
  for (const child of node.children) sortTree(child);
}

/**
 * 検索文字列に一致する用語を含むかチェックし、
 * 一致用語だけを残したノードのコピーを返す（なければ null）
 * フォルダ名にマッチした場合はそのフォルダ以下を全て表示する
 */
export function filterTree(node: FolderNode, query: string): FolderNode | null {
  // フォルダ名自体がクエリに一致する場合はノード全体を返す
  if (node.name && node.name.includes(query)) {
    return { ...node };
  }

  const filteredTerms = node.terms.filter(
    t =>
      t.name.includes(query) ||
      t.aliases.some(a => a.includes(query))
  );
  const filteredChildren: FolderNode[] = [];
  for (const child of node.children) {
    const result = filterTree(child, query);
    if (result) filteredChildren.push(result);
  }
  if (filteredTerms.length === 0 && filteredChildren.length === 0) return null;
  return { ...node, terms: filteredTerms, children: filteredChildren };
}

/** ノード配下の総用語数 */
export function countTerms(node: FolderNode): number {
  return (
    node.terms.length +
    node.children.reduce((s, c) => s + countTerms(c), 0)
  );
}

// ─────────────────────────────────────────
// カテゴリツリー（用語入力パレット用）
//
// サイドバーは「タグごとにセクションを分けて、その中で
// buildFolderTree() を呼ぶ」という構成を View 側で組み立てているが、
// 入力パレットは「カテゴリ → フォルダ → 用語」という3階層を
// そのままデータとして扱いたいため、ここで1段ラップした
// 構造を提供する。
// ─────────────────────────────────────────
export interface CategoryNode {
  tag: string;
  label: string;
  color: string;
  tree: FolderNode; // そのカテゴリに属する用語のフォルダツリー
}

/**
 * TermEntry[] を tagDefinitions の順序に従って
 * カテゴリ（tag）ごとのフォルダツリーに分割する。
 * 用語が1件も無いカテゴリは含めない。
 */
export function buildCategoryTree(
  terms: TermEntry[],
  tagDefinitions: TagDefinition[]
): CategoryNode[] {
  const result: CategoryNode[] = [];

  for (const td of tagDefinitions) {
    if (!td.enabled) continue;
    const termsInTag = terms.filter(t => t.tag === td.tag);
    if (termsInTag.length === 0) continue;

    const tree = buildFolderTree(termsInTag);
    sortTree(tree);

    result.push({ tag: td.tag, label: td.label, color: td.color, tree });
  }

  return result;
}
