// ─────────────────────────────────────────
// Novels Note JP — サイドバー View
// フォルダツリー展開式・検索対応
// ─────────────────────────────────────────

import { ItemView, WorkspaceLeaf, TFile, Plugin } from "obsidian";
import { SIDEBAR_VIEW_TYPE, TermEntry } from "./types";
import { TagDefinition } from "./settings";

// ─────────────────────────────────────────
// ツリーノード型
// ─────────────────────────────────────────
interface FolderNode {
  name: string;        // フォルダ表示名（最後のセグメント）
  fullPath: string;    // "characters/heroes" など
  children: FolderNode[];
  terms: TermEntry[];
}

// ─────────────────────────────────────────
// ツリー構築ヘルパー
// ─────────────────────────────────────────

/** filePath からフォルダパスを返す（ファイル名を除く）
 *  例: "characters/hero/alice.md" → "characters/hero"
 *      "alice.md"                 → ""（ルート）
 */
function folderOf(filePath: string): string {
  const idx = filePath.lastIndexOf("/");
  return idx === -1 ? "" : filePath.substring(0, idx);
}

/**
 * TermEntry[] をフォルダ階層ツリーに変換する。
 * rootPath: このタグセクション内での共通ルート（省略するプレフィックス）
 *           空文字ならすべてのパスをそのまま使う。
 */
function buildFolderTree(terms: TermEntry[]): FolderNode {
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
function sortTree(node: FolderNode): void {
  node.children.sort((a, b) => a.name.localeCompare(b.name, "ja"));
  node.terms.sort((a, b) => a.name.localeCompare(b.name, "ja"));
  for (const child of node.children) sortTree(child);
}

/** 検索文字列に一致する用語を含むかチェックし、
 *  一致用語だけを残したノードのコピーを返す（なければ null）*/
function filterTree(node: FolderNode, query: string): FolderNode | null {
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
function countTerms(node: FolderNode): number {
  return (
    node.terms.length +
    node.children.reduce((s, c) => s + countTerms(c), 0)
  );
}

// ─────────────────────────────────────────
// サイドバー View 本体
// ─────────────────────────────────────────
export class NovelsNoteSidebarView extends ItemView {
  private terms: TermEntry[] = [];
  private tagDefs: TagDefinition[] = [];

  /** 開閉状態を保持（key = "tagKey::folderFullPath"） */
  private openState = new Map<string, boolean>();

  /** 検索クエリ */
  private searchQuery = "";

  /**
   * プラグイン本体への参照。
   * onOpen() 時に最新データを自力で取得するために使う。
   * main.ts の registerView コールバックで渡す。
   */
  private plugin: (Plugin & { getTerms(): TermEntry[]; settings: any }) | null = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  /** main.ts の registerView コールバックから呼ぶ */
  setPlugin(plugin: Plugin & { getTerms(): TermEntry[]; settings: any }): void {
    this.plugin = plugin;
  }

  getViewType(): string { return SIDEBAR_VIEW_TYPE; }
  getDisplayText(): string { return "Novels Note JP"; }
  getIcon(): string { return "book-open"; }

  /**
   * onOpen はサイドバーが「開かれた瞬間」に呼ばれる。
   * この時点では main.ts の updateSidebar() がまだ走っていない場合があるため、
   * プラグインから直接最新データを取得して描画する。
   */
  async onOpen(): Promise<void> {
    if (this.plugin) {
      this.terms   = this.plugin.getTerms();
      this.tagDefs = this.plugin.settings.tagDefinitions;
    }
    this.render();
  }
  async onClose(): Promise<void> {}

  setTerms(terms: TermEntry[], tagDefs: TagDefinition[]): void {
    this.terms = terms;
    this.tagDefs = tagDefs;
    this.render();
  }

  // ─────────────────────────────────────────
  // 描画メイン
  // ─────────────────────────────────────────
  private render(): void {
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.addClass("novels-note-sidebar");

    // ── ヘッダー ──
    const header = root.createEl("div", { cls: "nn-header" });
    header.createEl("span", { text: "Novels Note JP", cls: "nn-header-title" });

    // 全展開 / 全折りたたみボタン
    const btnBar = header.createEl("div", { cls: "nn-header-buttons" });
    const btnExpand = btnBar.createEl("button", { cls: "nn-btn", title: "すべて展開" });
    btnExpand.innerHTML = `<svg viewBox="0 0 16 16" width="14" height="14"><path fill="currentColor" d="M2 5l6 6 6-6"/></svg>`;
    const btnCollapse = btnBar.createEl("button", { cls: "nn-btn", title: "すべて折りたたむ" });
    btnCollapse.innerHTML = `<svg viewBox="0 0 16 16" width="14" height="14"><path fill="currentColor" d="M14 11L8 5l-6 6"/></svg>`;

    btnExpand.addEventListener("click", () => {
      this.openState.forEach((_, k) => this.openState.set(k, true));
      this.renderBody(body);
    });
    btnCollapse.addEventListener("click", () => {
      this.openState.forEach((_, k) => this.openState.set(k, false));
      this.renderBody(body);
    });

    // ── 検索ボックス ──
    const searchWrap = root.createEl("div", { cls: "nn-search-wrap" });
    const searchInput = searchWrap.createEl("input", {
      type: "text",
      placeholder: "検索…",
      cls: "nn-search-input",
    });
    searchInput.value = this.searchQuery;
    searchInput.addEventListener("input", () => {
      this.searchQuery = searchInput.value.trim();
      this.renderBody(body);
    });

    // ── ボディ ──
    const body = root.createEl("div", { cls: "nn-body" });
    this.renderBody(body);
  }

  // ─────────────────────────────────────────
  // ボディ（タグセクション一覧）の描画
  // 検索・開閉変化のたびにここだけ再描画
  // ─────────────────────────────────────────
  private renderBody(body: HTMLElement): void {
    body.empty();

    const query = this.searchQuery;
    let totalVisible = 0;

    for (const td of this.tagDefs) {
      const tagTerms = this.terms.filter(t => t.tag === td.tag);
      if (tagTerms.length === 0) continue;

      // ツリー構築
      let tree = buildFolderTree(tagTerms);
      sortTree(tree);

      // 検索フィルタ
      if (query !== "") {
        const filtered = filterTree(tree, query);
        if (!filtered) continue;
        tree = filtered;
      }

      const visible = countTerms(tree);
      if (visible === 0) continue;
      totalVisible += visible;

      // タグセクションヘッダー
      const sectionKey = `tag::${td.tag}`;
      const isTagOpen = this.openState.get(sectionKey) ?? true;

      const section = body.createEl("div", { cls: "nn-section" });
      const sectionHeader = section.createEl("div", { cls: "nn-section-header" });

      const arrow = sectionHeader.createEl("span", {
        cls: `nn-arrow ${isTagOpen ? "nn-arrow-open" : ""}`,
        text: "▶",
      });
      sectionHeader.createEl("span", {
        text: td.label,
        cls: `nn-section-label novel-hl-${td.tag}`,
      });
      sectionHeader.createEl("span", {
        text: String(visible),
        cls: "nn-count",
      });

      const sectionBody = section.createEl("div", {
        cls: "nn-section-body",
      });
      sectionBody.style.display = isTagOpen ? "" : "none";

      sectionHeader.addEventListener("click", () => {
        const next = !(this.openState.get(sectionKey) ?? true);
        this.openState.set(sectionKey, next);
        arrow.classList.toggle("nn-arrow-open", next);
        sectionBody.style.display = next ? "" : "none";
      });

      // ツリー描画（ルート直下の用語 → サブフォルダ）
      this.renderFolderNode(sectionBody, tree, td.tag, query !== "");
    }

    if (totalVisible === 0) {
      body.createEl("p", {
        text:
          query !== ""
            ? `「${query}」は見つかりませんでした。`
            : "タグが設定された .md ファイルを作成してください。",
        cls: "nn-empty",
      });
    }
  }

  // ─────────────────────────────────────────
  // フォルダノードの再帰描画
  // ─────────────────────────────────────────
  private renderFolderNode(
    container: HTMLElement,
    node: FolderNode,
    tag: string,
    forceOpen: boolean,
  ): void {
    // ルート直下の用語を先に描画
    for (const term of node.terms) {
      this.renderTermItem(container, term, tag);
    }

    // サブフォルダ
    for (const child of node.children) {
      this.renderFolderItem(container, child, tag, forceOpen);
    }
  }

  /** フォルダ行 + 中身（再帰） */
  private renderFolderItem(
    container: HTMLElement,
    node: FolderNode,
    tag: string,
    forceOpen: boolean,
  ): void {
    const stateKey = `${tag}::${node.fullPath}`;
    // 初回 or 検索中は開いた状態にする
    const isOpen = forceOpen || (this.openState.get(stateKey) ?? false);
    if (!this.openState.has(stateKey)) {
      this.openState.set(stateKey, false); // デフォルトは閉じ
    }

    const wrap = container.createEl("div", { cls: "nn-folder-wrap" });

    // フォルダ行
    const folderRow = wrap.createEl("div", { cls: "nn-folder-row" });
    const arrow = folderRow.createEl("span", {
      cls: `nn-arrow ${isOpen ? "nn-arrow-open" : ""}`,
      text: "▶",
    });
    folderRow.createEl("span", {
      cls: "nn-folder-icon",
      text: isOpen ? "📂" : "📁",
    });
    folderRow.createEl("span", {
      text: node.name,
      cls: "nn-folder-name",
    });
    folderRow.createEl("span", {
      text: String(countTerms(node)),
      cls: "nn-count",
    });

    // 中身
    const children = wrap.createEl("div", { cls: "nn-folder-children" });
    children.style.display = isOpen ? "" : "none";

    folderRow.addEventListener("click", () => {
      const next = !this.openState.get(stateKey);
      this.openState.set(stateKey, next);
      arrow.classList.toggle("nn-arrow-open", next);
      (folderRow.querySelector(".nn-folder-icon") as HTMLElement).textContent =
        next ? "📂" : "📁";
      children.style.display = next ? "" : "none";
    });

    this.renderFolderNode(children, node, tag, forceOpen);
  }

  /** 用語 1 件の行 */
  private renderTermItem(
    container: HTMLElement,
    term: TermEntry,
    tag: string
  ): void {
    const row = container.createEl("div", { cls: "nn-term-row" });
    const nameEl = row.createEl("span", {
      text: term.name,
      cls: `nn-term-name novel-hl-${tag}`,
      title: term.filePath,
    });
    if (term.aliases.length > 0) {
      row.createEl("span", {
        text: `（${term.aliases.join("・")}）`,
        cls: "nn-aliases",
      });
    }

    // クリックで該当ノートを開く
    nameEl.addEventListener("click", (e) => {
      e.stopPropagation();
      const file = this.app.vault.getAbstractFileByPath(term.filePath);
      if (file instanceof TFile) {
        this.app.workspace.getLeaf(false).openFile(file);
      }
    });
  }
}
