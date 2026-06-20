// ─────────────────────────────────────────
// Novels Note JP — サイドバー View
// フォルダツリー展開式・検索対応
// ─────────────────────────────────────────

import { ItemView, WorkspaceLeaf, TFile, Plugin, Notice, Modal, Menu, App } from "obsidian";
import { SIDEBAR_VIEW_TYPE, TermEntry, TERM_DRAG_MIME_TYPE } from "../types";
import { TagDefinition } from "../settings";

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
// 用語ノート新規作成ダイアログ
// ─────────────────────────────────────────
class CreateTermModal extends Modal {
  private folderPath: string;
  private tag: string;
  private tagLabel: string;
  private onSubmit: (termName: string) => void;
  private focusTimer?: ReturnType<typeof setTimeout>;

  constructor(
    app: App,
    folderPath: string,
    tag: string,
    tagLabel: string,
    onSubmit: (termName: string) => void
  ) {
    super(app);
    this.folderPath = folderPath;
    this.tag = tag;
    this.tagLabel = tagLabel;
    this.onSubmit = onSubmit;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("nn-create-term-modal");

    contentEl.createEl("h3", { text: "用語ノートを新規作成", cls: "nn-modal-title" });

    const infoEl = contentEl.createEl("div", { cls: "nn-modal-info" });
    infoEl.createEl("span", { text: "フォルダ：", cls: "nn-modal-label" });
    infoEl.createEl("span", {
      text: this.folderPath || "（ルート）",
      cls: "nn-modal-value"
    });
    infoEl.createEl("br");
    infoEl.createEl("span", { text: "カテゴリ：", cls: "nn-modal-label" });
    infoEl.createEl("span", {
      text: this.tagLabel,
      cls: "nn-modal-value"
    });

    const inputWrap = contentEl.createEl("div", { cls: "nn-modal-input-wrap" });
    inputWrap.createEl("label", { text: "用語名", cls: "nn-modal-field-label" });
    const input = inputWrap.createEl("input", {
      type: "text",
      placeholder: "用語名を入力してください",
      cls: "nn-modal-input",
    });

    const btnRow = contentEl.createEl("div", { cls: "nn-modal-btn-row" });
    const cancelBtn = btnRow.createEl("button", { text: "キャンセル", cls: "nn-modal-btn nn-modal-btn-cancel" });
    const createBtn = btnRow.createEl("button", { text: "作成", cls: "nn-modal-btn nn-modal-btn-create" });

    const submit = () => {
      const name = input.value.trim();
      if (!name) {
        input.addClass("nn-modal-input-error");
        input.focus();
        return;
      }
      this.close();
      this.onSubmit(name);
    };

    input.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter") submit();
      if (e.key === "Escape") this.close();
    });
    cancelBtn.addEventListener("click", () => this.close());
    createBtn.addEventListener("click", submit);

    this.focusTimer = setTimeout(() => input.focus(), 50);
  }

  onClose(): void {
    if (this.focusTimer !== undefined) clearTimeout(this.focusTimer);
    this.contentEl.empty();
  }
}

// ─────────────────────────────────────────
// 削除確認ダイアログ
// ─────────────────────────────────────────
class ConfirmDeleteModal extends Modal {
  private termName: string;
  private filePath: string;
  private onResult: (confirmed: boolean) => void;

  constructor(
    app: App,
    termName: string,
    filePath: string,
    onResult: (confirmed: boolean) => void
  ) {
    super(app);
    this.termName = termName;
    this.filePath = filePath;
    this.onResult = onResult;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("nn-confirm-modal");

    contentEl.createEl("h3", { text: "用語ノートの削除", cls: "nn-modal-title" });
    contentEl.createEl("p", {
      text: `「${this.termName}」をゴミ箱に移動します。`,
      cls: "nn-modal-text"
    });
    contentEl.createEl("p", {
      text: this.filePath,
      cls: "nn-modal-path"
    });

    const btnRow = contentEl.createEl("div", { cls: "nn-modal-btn-row" });
    const cancelBtn = btnRow.createEl("button", { text: "キャンセル", cls: "nn-modal-btn nn-modal-btn-cancel" });
    const deleteBtn = btnRow.createEl("button", { text: "削除", cls: "nn-modal-btn nn-modal-btn-delete" });

    cancelBtn.addEventListener("click", () => { this.close(); this.onResult(false); });
    deleteBtn.addEventListener("click", () => { this.close(); this.onResult(true); });
  }

  onClose(): void {
    this.contentEl.empty();
  }
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

/**
 * 検索文字列に一致する用語を含むかチェックし、
 * 一致用語だけを残したノードのコピーを返す（なければ null）
 * フォルダ名にマッチした場合はそのフォルダ以下を全て表示する
 */
function filterTree(node: FolderNode, query: string): FolderNode | null {
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

  /** D&D: ドラッグ中の用語 */
  private dragTerm: TermEntry | null = null;

  /**
   * プラグイン本体への参照
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
  getDisplayText(): string { return "用語インデックス"; }
  getIcon(): string { return "list-tree"; }

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
    header.createEl("span", { text: "用語インデックス", cls: "nn-header-title" });

    // 全展開 / 全折りたたみボタン
    const btnBar = header.createEl("div", { cls: "nn-header-buttons" });
    const btnExpand = btnBar.createEl("button", { cls: "nn-btn", title: "すべて展開" });
    btnExpand.innerHTML = `<svg viewBox="0 0 16 16" width="14" height="14"><path fill="currentColor" d="M2 5l6 6 6-6"/></svg>`;
    const btnCollapse = btnBar.createEl("button", { cls: "nn-btn", title: "すべて折りたたむ" });
    btnCollapse.innerHTML = `<svg viewBox="0 0 16 16" width="14" height="14"><path fill="currentColor" d="M14 11L8 5l-6 6"/></svg>`;

    btnExpand.addEventListener("click", () => {
      this.openState.forEach((_, k) => this.openState.set(k, true));
      for (const td of this.tagDefs) {
        this.openState.set(`tag::${td.tag}`, true);
      }
      this.renderBody(body);
    });
    btnCollapse.addEventListener("click", () => {
      this.openState.forEach((_, k) => this.openState.set(k, false));
      for (const td of this.tagDefs) {
        this.openState.set(`tag::${td.tag}`, false);
      }
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

    const clearBtn = searchWrap.createEl("button", {
      cls: "nn-search-clear",
      title: "クリア",
      text: "✕",
    });
    clearBtn.style.display = this.searchQuery ? "" : "none";

    searchInput.addEventListener("input", () => {
      this.searchQuery = searchInput.value.trim();
      clearBtn.style.display = this.searchQuery ? "" : "none";
      this.renderBody(body);
    });

    clearBtn.addEventListener("click", () => {
      searchInput.value = "";
      this.searchQuery = "";
      clearBtn.style.display = "none";
      searchInput.focus();
      this.renderBody(body);
    });

    // ── ボディ ──
    const body = root.createEl("div", { cls: "nn-body" });
    this.renderBody(body);
  }

  // ─────────────────────────────────────────
  // ボディ（カテゴリセクション一覧）の描画
  // ─────────────────────────────────────────
  private renderBody(body: HTMLElement): void {
    body.empty();

    const query = this.searchQuery;

    // 検索中に表示するカテゴリが 1 つもなかった場合のフラグ
    let anyVisibleInSearch = false;

    for (const td of this.tagDefs) {
      const tagTerms = this.terms.filter(t => t.tag === td.tag);

      // ツリー構築
      let tree = buildFolderTree(tagTerms);
      sortTree(tree);

      // 検索フィルタ：検索中はヒットしたカテゴリのみ表示
      let visible = countTerms(tree);
      if (query !== "") {
        const filtered = filterTree(tree, query);
        if (!filtered) continue;
        tree = filtered;
        visible = countTerms(tree);
        if (visible === 0) continue;
        anyVisibleInSearch = true;
      }

      // カテゴリセクションヘッダー
      const sectionKey = `tag::${td.tag}`;
      if (!this.openState.has(sectionKey)) {
        this.openState.set(sectionKey, false);
      }
      const isTagOpen = this.openState.get(sectionKey) ?? false;

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
      // 用語が 1 件以上あるときだけカウントバッジを表示
      if (visible > 0) {
        sectionHeader.createEl("span", {
          text: String(visible),
          cls: "nn-count",
        });
      }

      const sectionBody = section.createEl("div", {
        cls: "nn-section-body",
      });
      sectionBody.style.display = isTagOpen ? "" : "none";

      // クリック：開閉
      sectionHeader.addEventListener("click", () => {
        const next = !(this.openState.get(sectionKey) ?? false);
        this.openState.set(sectionKey, next);
        arrow.classList.toggle("nn-arrow-open", next);
        sectionBody.style.display = next ? "" : "none";
      });

      // 右クリック：カテゴリコンテキストメニュー
      sectionHeader.addEventListener("contextmenu", (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        this.showCategoryContextMenu(e, td);
      });

      // ツリー描画（ルート直下の用語 → サブフォルダ）
      if (visible > 0) {
        this.renderFolderNode(sectionBody, tree, td, query !== "");
      } else {
        // 用語 0 件のカテゴリには案内テキストを表示
        sectionBody.createEl("p", {
          text: "用語ノートがありません。右クリックで新規作成できます。",
          cls: "nn-empty nn-empty-hint",
        });
      }
    }

    // 検索中に何もヒットしなかった場合のみ「見つかりません」を表示
    if (query !== "" && !anyVisibleInSearch) {
      body.createEl("p", {
        text: `「${query}」は見つかりませんでした。`,
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
    td: TagDefinition,
    forceOpen: boolean,
  ): void {
    // ルート直下の用語を先に描画
    for (const term of node.terms) {
      this.renderTermItem(container, term, td.tag);
    }

    // サブフォルダ
    for (const child of node.children) {
      this.renderFolderItem(container, child, td, forceOpen);
    }
  }

  /** フォルダ行 + 中身（再帰） */
  private renderFolderItem(
    container: HTMLElement,
    node: FolderNode,
    td: TagDefinition,
    forceOpen: boolean,
  ): void {
    const stateKey = `${td.tag}::${node.fullPath}`;
    const isOpen = forceOpen || (this.openState.get(stateKey) ?? false);
    if (!this.openState.has(stateKey)) {
      this.openState.set(stateKey, false);
    }

    const wrap = container.createEl("div", { cls: "nn-folder-wrap" });

    // フォルダ行
    const folderRow = wrap.createEl("div", {
      cls: "nn-folder-row",
      attr: { "data-folder-path": node.fullPath, "data-tag": td.tag }
    });

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

    // クリック（開閉）
    folderRow.addEventListener("click", (e: MouseEvent) => {
      e.stopPropagation();
      const next = !this.openState.get(stateKey);
      this.openState.set(stateKey, next);
      arrow.classList.toggle("nn-arrow-open", next);
      (folderRow.querySelector(".nn-folder-icon") as HTMLElement).textContent =
        next ? "📂" : "📁";
      children.style.display = next ? "" : "none";
    });

    // 右クリックメニュー（フォルダ）
    folderRow.addEventListener("contextmenu", (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      this.showFolderContextMenu(e, node, td);
    });

    // D&D ドロップターゲット
    folderRow.addEventListener("dragover", (e: DragEvent) => {
      if (this.dragTerm) {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
        folderRow.addClass("nn-drop-target");
      }
    });
    folderRow.addEventListener("dragleave", () => {
      folderRow.removeClass("nn-drop-target");
    });
    folderRow.addEventListener("drop", (e: DragEvent) => {
      e.preventDefault();
      folderRow.removeClass("nn-drop-target");
      if (this.dragTerm) {
        this.moveTermToFolder(this.dragTerm, node.fullPath);
        this.dragTerm = null;
      }
    });

    this.renderFolderNode(children, node, td, forceOpen);
  }

  /** 用語 1 件の行 */
  private renderTermItem(
    container: HTMLElement,
    term: TermEntry,
    tag: string
  ): void {
    const row = container.createEl("div", {
      cls: "nn-term-row",
      attr: { draggable: "true" }
    });

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
    nameEl.addEventListener("click", (e: MouseEvent) => {
      e.stopPropagation();
      const file = this.app.vault.getAbstractFileByPath(term.filePath);
      if (file instanceof TFile) {
        this.app.workspace.getLeaf(false).openFile(file);
      }
    });

    // 右クリックメニュー（用語）
    row.addEventListener("contextmenu", (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      this.showTermContextMenu(e, term);
    });

    // D&D ドラッグ開始
    row.addEventListener("dragstart", (e: DragEvent) => {
      this.dragTerm = term;
      row.addClass("nn-dragging");
      if (e.dataTransfer) {
        // move  : サイドバー内でのフォルダ間移動（既存機能）
        // copy  : メインエディタへの Wikilink 挿入（新機能）
        e.dataTransfer.effectAllowed = "copyMove";
        e.dataTransfer.setData("text/plain", term.filePath);
        e.dataTransfer.setData(
          TERM_DRAG_MIME_TYPE,
          JSON.stringify({ filePath: term.filePath, name: term.name })
        );
      }
    });
    row.addEventListener("dragend", () => {
      this.dragTerm = null;
      row.removeClass("nn-dragging");
    });
  }

  // ─────────────────────────────────────────
  // 右クリックメニュー（カテゴリヘッダー）
  // ─────────────────────────────────────────
  private showCategoryContextMenu(e: MouseEvent, td: TagDefinition): void {
    const menu = new Menu();

    menu.addItem(item => {
      item
        .setTitle("用語ノートを新規作成する")
        .setIcon("file-plus")
        .onClick(() => {
          // フォルダパスは空文字（Vault ルート）で作成ダイアログを開く
          new CreateTermModal(
            this.app,
            "",
            td.tag,
            td.label,
            async (termName: string) => {
              await this.createTermNote(termName, "", td.tag);
            }
          ).open();
        });
    });

    menu.showAtMouseEvent(e);
  }

  // ─────────────────────────────────────────
  // 右クリックメニュー（フォルダ）
  // ─────────────────────────────────────────
  private showFolderContextMenu(e: MouseEvent, node: FolderNode, td: TagDefinition): void {
    const menu = new Menu();

    menu.addItem(item => {
      item
        .setTitle("用語ノートを新規作成する")
        .setIcon("file-plus")
        .onClick(() => {
          new CreateTermModal(
            this.app,
            node.fullPath,
            td.tag,
            td.label,
            async (termName: string) => {
              await this.createTermNote(termName, node.fullPath, td.tag);
            }
          ).open();
        });
    });

    menu.showAtMouseEvent(e);
  }

  // ─────────────────────────────────────────
  // 右クリックメニュー（用語）
  // ─────────────────────────────────────────
  private showTermContextMenu(e: MouseEvent, term: TermEntry): void {
    const menu = new Menu();

    menu.addItem(item => {
      item
        .setTitle("ノートを開く")
        .setIcon("file-text")
        .onClick(() => {
          const file = this.app.vault.getAbstractFileByPath(term.filePath);
          if (file instanceof TFile) {
            this.app.workspace.getLeaf(false).openFile(file);
          }
        });
    });

    menu.addSeparator();

    menu.addItem(item => {
      item
        .setTitle("用語ノートを削除する")
        .setIcon("trash")
        .onClick(async () => {
          await this.deleteTermNote(term);
        });
    });

    menu.showAtMouseEvent(e);
  }

  // ─────────────────────────────────────────
  // 用語ノート新規作成
  // ─────────────────────────────────────────
  private async createTermNote(termName: string, folderPath: string, tag: string): Promise<void> {
    try {
      // フォルダが存在しない場合は作成
      if (folderPath) {
        const folder = this.app.vault.getAbstractFileByPath(folderPath);
        if (!folder) {
          await this.app.vault.createFolder(folderPath);
        }
      }

      const fileName = `${termName}.md`;
      const filePath = folderPath ? `${folderPath}/${fileName}` : fileName;

      // 既存ファイルチェック
      const existing = this.app.vault.getAbstractFileByPath(filePath);
      if (existing) {
        new Notice(`「${fileName}」はすでに存在します。`);
        return;
      }

      // フロントマターを生成（tags のみ）
      const content = `---\ntags:\n  - ${tag}\n---\n\n`;

      const newFile = await this.app.vault.create(filePath, content);
      new Notice(`「${termName}」を作成しました。`);

      // 作成したノートを開く
      await this.app.workspace.getLeaf(false).openFile(newFile);
    } catch (err) {
      new Notice(`ノートの作成に失敗しました: ${err}`);
      console.error("Novels Note JP: 用語ノート作成エラー", err);
    }
  }

  // ─────────────────────────────────────────
  // 用語ノート削除
  // ─────────────────────────────────────────
  private async deleteTermNote(term: TermEntry): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(term.filePath);
    if (!(file instanceof TFile)) {
      new Notice("ファイルが見つかりません。");
      return;
    }

    const confirmed = await new Promise<boolean>(resolve => {
      new ConfirmDeleteModal(this.app, term.name, term.filePath, resolve).open();
    });
    if (!confirmed) return;

    try {
      await this.app.vault.trash(file, true);
      new Notice(`「${term.name}」をゴミ箱に移動しました。`);
    } catch (err) {
      new Notice(`削除に失敗しました: ${err}`);
      console.error("Novels Note JP: 用語ノート削除エラー", err);
    }
  }

  // ─────────────────────────────────────────
  // 用語ノートをフォルダへ移動（D&D）
  // ─────────────────────────────────────────
  private async moveTermToFolder(term: TermEntry, targetFolderPath: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(term.filePath);
    if (!(file instanceof TFile)) {
      new Notice("移動元ファイルが見つかりません。");
      return;
    }

    const fileName = file.name;
    const newPath = targetFolderPath ? `${targetFolderPath}/${fileName}` : fileName;

    if (newPath === term.filePath) return;

    // 移動先に同名ファイルがないか確認
    const existing = this.app.vault.getAbstractFileByPath(newPath);
    if (existing) {
      new Notice(`「${fileName}」は移動先にすでに存在します。`);
      return;
    }

    try {
      // 移動先フォルダが存在しない場合は作成
      if (targetFolderPath) {
        const targetFolder = this.app.vault.getAbstractFileByPath(targetFolderPath);
        if (!targetFolder) {
          await this.app.vault.createFolder(targetFolderPath);
        }
      }

      await this.app.vault.rename(file, newPath);
      new Notice(`「${term.name}」を移動しました。`);
    } catch (err) {
      new Notice(`移動に失敗しました: ${err}`);
      console.error("Novels Note JP: 用語ノート移動エラー", err);
    }
  }
}
