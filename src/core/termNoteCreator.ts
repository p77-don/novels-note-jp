// ─────────────────────────────────────────
// Novels Note JP — 用語ノート新規作成（共通処理）
//
// サイドバー（用語インデックス）とエディタ本文の右クリックメニューの
// 両方から用語ノートを新規作成できるようにするため、
// モーダルと作成ロジックをここに集約する。
// ─────────────────────────────────────────

import { App, Modal, Notice, Platform, TFile } from "obsidian";
import { TagDefinition } from "../settings";

// ─────────────────────────────────────────
// 用語ノート新規作成ダイアログ
// ─────────────────────────────────────────
export class CreateTermModal extends Modal {
  private folderPath: string;
  private tagDefs: TagDefinition[];
  private initialTag: string;
  private defaultTermName: string;
  private onSubmit: (termName: string, folderPath: string, tag: string) => Promise<void>;
  private focusTimer?: number;

  constructor(
    app: App,
    folderPath: string,
    tagDefs: TagDefinition[],
    initialTag: string,
    onSubmit: (termName: string, folderPath: string, tag: string) => Promise<void>,
    defaultTermName = ""
  ) {
    super(app);
    this.folderPath = folderPath;
    // 選択式に表示するのは有効なカテゴリのみ
    this.tagDefs = tagDefs.filter(td => td.enabled);
    this.initialTag = initialTag;
    this.onSubmit = onSubmit;
    this.defaultTermName = defaultTermName;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("nn-create-term-modal");

    // ソフトウェアキーボードはOSネイティブのUIであり、WebView内の
    // どんなCSS z-indexよりも常に最前面に表示される。モーダルが
    // 画面中央（＝キーボードの占める領域と重なる位置）に表示されると、
    // キーボードに隠れて操作できなくなるため、モバイルでは画面上部
    // （キーボードが占めない領域）を起点に表示する。
    if (Platform.isMobile) {
      this.containerEl.addClass("nn-mobile-top-modal-container");
      this.modalEl.addClass("nn-mobile-top-modal");
    }

    const titleEl = contentEl.createEl("h3", { text: "用語ノートを新規作成", cls: "nn-modal-title" });

    // カテゴリ選択（プルダウン）
    const categoryWrap = contentEl.createDiv({ cls: "nn-modal-input-wrap" });
    categoryWrap.createEl("label", { text: "カテゴリ", cls: "nn-modal-field-label" });
    const categorySelect = categoryWrap.createEl("select", { cls: "nn-modal-input nn-modal-select-category" });
    for (const td of this.tagDefs) {
      const opt = categorySelect.createEl("option", { text: td.label, value: td.tag });
      if (td.tag === this.initialTag) opt.selected = true;
    }
    // initialTag が有効カテゴリ一覧に含まれない場合（無効化されたカテゴリ経由で
    // 開かれた等）でも選択肢として表示できるよう、末尾に補完しておく
    if (!this.tagDefs.some(td => td.tag === this.initialTag)) {
      const fallback = categorySelect.createEl("option", { text: this.initialTag, value: this.initialTag });
      fallback.selected = true;
    }

    // タイトル部分をタップすると、入力欄からフォーカスを外して
    // ソフトウェアキーボードを閉じられるようにする
    // （Obsidian側の「モーダル外タップで閉じる」挙動が当てにならない
    //  場合があるため、明示的な手段を用意する）。
    const dismissKeyboard = () => {
      const active = contentEl.ownerDocument.activeElement;
      if (active instanceof HTMLElement && contentEl.contains(active)) {
        active.blur();
      }
    };
    titleEl.addEventListener("mousedown", dismissKeyboard);

    // フォルダパス入力（任意）
    const folderWrap = contentEl.createDiv({ cls: "nn-modal-input-wrap" });
    folderWrap.createEl("label", { text: "フォルダ（任意）", cls: "nn-modal-field-label" });
    const folderInput = folderWrap.createEl("input", {
      type: "text",
      placeholder: "例: characters/heroes （空欄でルートに作成）",
      cls: "nn-modal-input nn-modal-input-folder",
    });
    folderInput.value = this.folderPath;

    // 用語名入力
    const inputWrap = contentEl.createDiv({ cls: "nn-modal-input-wrap" });
    inputWrap.createEl("label", { text: "用語名", cls: "nn-modal-field-label" });
    const input = inputWrap.createEl("input", {
      type: "text",
      placeholder: "用語名を入力してください",
      cls: "nn-modal-input",
    });
    // 本文で選択した文字列などをデフォルト値として引き継ぐ
    if (this.defaultTermName) {
      input.value = this.defaultTermName;
    }

    const btnRow = contentEl.createDiv({ cls: "nn-modal-btn-row" });
    const cancelBtn = btnRow.createEl("button", { text: "キャンセル", cls: "nn-modal-btn nn-modal-btn-cancel" });
    const createBtn = btnRow.createEl("button", { text: "作成", cls: "nn-modal-btn nn-modal-btn-create" });

    const submit = () => {
      const name = input.value.trim();
      if (!name) {
        input.addClass("nn-modal-input-error");
        input.focus();
        return;
      }
      // フォルダパスの末尾スラッシュを除去して正規化
      const folder = folderInput.value.trim().replace(/\/+$/, "");
      const tag = categorySelect.value;
      this.close();
      void this.onSubmit(name, folder, tag);
    };

    // Tab キーでフォルダ入力 → 用語名入力へ移動
    folderInput.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter") { e.preventDefault(); input.focus(); }
      if (e.key === "Escape") this.close();
    });
    input.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter") submit();
      if (e.key === "Escape") this.close();
    });
    cancelBtn.addEventListener("click", () => this.close());
    createBtn.addEventListener("click", submit);

    // デフォルト用語名がある場合は用語名欄にフォーカスし、
    // そのまま上書きしやすいよう内容を選択状態にする。
    // それ以外はフォルダパスが空のときは用語名にフォーカス、
    // 入力済みなら用語名に（フォルダを確認してから進めやすくする）。
    this.focusTimer = window.setTimeout(() => {
      if (this.defaultTermName) {
        input.focus();
        input.select();
      } else if (this.folderPath) {
        input.focus();
      } else {
        folderInput.focus();
      }
    }, 50);
  }

  onClose(): void {
    if (this.focusTimer !== undefined) window.clearTimeout(this.focusTimer);
    this.contentEl.empty();
  }
}

// ─────────────────────────────────────────
// フォルダ作成確認ダイアログ
// ─────────────────────────────────────────
export class ConfirmFolderCreateModal extends Modal {
  private folderPath: string;
  private onResult: (confirmed: boolean) => void;

  constructor(
    app: App,
    folderPath: string,
    onResult: (confirmed: boolean) => void
  ) {
    super(app);
    this.folderPath = folderPath;
    this.onResult = onResult;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("nn-confirm-modal");

    contentEl.createEl("h3", { text: "フォルダの作成", cls: "nn-modal-title" });
    contentEl.createEl("p", {
      text: "指定されたフォルダは存在しません。フォルダを作成しますか？",
      cls: "nn-modal-text"
    });
    contentEl.createEl("p", {
      text: this.folderPath,
      cls: "nn-modal-path"
    });

    const btnRow = contentEl.createDiv({ cls: "nn-modal-btn-row" });
    const cancelBtn = btnRow.createEl("button", { text: "キャンセル", cls: "nn-modal-btn nn-modal-btn-cancel" });
    const confirmBtn = btnRow.createEl("button", { text: "作成する", cls: "nn-modal-btn nn-modal-btn-create" });

    cancelBtn.addEventListener("click", () => { this.close(); this.onResult(false); });
    confirmBtn.addEventListener("click", () => { this.close(); this.onResult(true); });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

// ─────────────────────────────────────────
// 用語ノート新規作成（共通処理本体）
//
// サイドバーの各種右クリックメニュー、エディタ本文の右クリック
// メニューの両方から呼び出される。
// ─────────────────────────────────────────
export async function createTermNote(
  app: App,
  termName: string,
  folderPath: string,
  tag: string
): Promise<TFile | null> {
  try {
    // フォルダが指定されている場合、存在確認 → 不存在なら確認ダイアログ
    if (folderPath) {
      const folder = app.vault.getAbstractFileByPath(folderPath);
      if (!folder) {
        const confirmed = await new Promise<boolean>(resolve => {
          new ConfirmFolderCreateModal(app, folderPath, resolve).open();
        });
        if (!confirmed) return null;
        await app.vault.createFolder(folderPath);
      }
    }

    const fileName = `${termName}.md`;
    const filePath = folderPath ? `${folderPath}/${fileName}` : fileName;

    // 既存ファイルチェック
    const existing = app.vault.getAbstractFileByPath(filePath);
    if (existing) {
      new Notice(`「${fileName}」はすでに存在します。`);
      return null;
    }

    // フロントマターを生成（tags のみ）
    const content = `---\ntags:\n  - ${tag}\n---\n\n`;

    const newFile = await app.vault.create(filePath, content);
    new Notice(`「${termName}」を作成しました。`);

    // 作成したノートを開く
    await app.workspace.getLeaf(false).openFile(newFile);
    return newFile;
  } catch (err) {
    new Notice(`ノートの作成に失敗しました: ${err}`);
    console.error("Novels Note JP: 用語ノート作成エラー", err);
    return null;
  }
}
