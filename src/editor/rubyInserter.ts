// ─────────────────────────────────────────
// Novels Note JP — ルビ挿入・傍点挿入
//
// エディタ上でテキストを選択して右クリック →
// 「ルビを振る」→ ポップアップでルビを入力 →
// 設定の rubyStyle に応じた記法で挿入する。
//
// 「傍点を振る」→ 1文字ずつ「・」をルビとして即挿入する。
// ─────────────────────────────────────────

import { App, Editor, MarkdownView, Menu, Modal, Notice, Platform } from "obsidian";
import { NovelsNoteSettings, RubyStyle } from "../settings";

// ─────────────────────────────────────────
// ルビ記法への変換（1ペア）
// ─────────────────────────────────────────
function buildRubyText(base: string, ruby: string, style: RubyStyle): string {
  switch (style) {
    case "narou":
      // |base《ruby》（半角縦棒）
      return `|${base}《${ruby}》`;
    case "aozora":
      // ｜base《ruby》（全角縦棒）
      return `｜${base}《${ruby}》`;
    case "denden":
      // {base|ruby}
      return `{${base}|${ruby}}`;
    case "html":
      return `<ruby>${base}<rt>${ruby}</rt></ruby>`;
  }
}

// ─────────────────────────────────────────
// 傍点記法への変換
//
// 選択文字列を Unicode コードポイント単位（Array.from）で
// 1文字ずつ分割し、それぞれに「・」をルビとして振る。
// 例）「ありがとう」→「|あ《・》|り《・》|が《・》|と《・》|う《・》」
// ─────────────────────────────────────────
function buildBoutenText(selected: string, style: RubyStyle): string {
  // Array.from でサロゲートペア・結合文字を1文字として扱う
  return Array.from(selected)
    .map(ch => buildRubyText(ch, "・", style))
    .join("");
}

// ─────────────────────────────────────────
// ルビ入力モーダル
// ─────────────────────────────────────────
class RubyInputModal extends Modal {
  private baseText: string;
  private style: RubyStyle;
  private onSubmit: (rubyText: string) => void;
  private focusTimer?: ReturnType<typeof setTimeout>;

  constructor(
    app: App,
    baseText: string,
    style: RubyStyle,
    onSubmit: (rubyText: string) => void
  ) {
    super(app);
    this.baseText = baseText;
    this.style = style;
    this.onSubmit = onSubmit;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("nn-ruby-modal");

    // モバイルではモーダルが画面中央に表示されると、下半分
    // （プレビュー部分）が入力用キーボードの裏に隠れてしまう。
    // モーダル自体を画面上部に寄せて、キーボードと重ならない
    // 領域を確保する。
    if (Platform.isMobile) {
      this.modalEl.addClass("nn-modal-top-aligned");
    }

    contentEl.createEl("h3", { text: "ルビを振る", cls: "nn-modal-title" });

    const infoEl = contentEl.createEl("div", { cls: "nn-modal-info" });
    infoEl.createEl("span", { text: "親文字：", cls: "nn-modal-label" });
    infoEl.createEl("span", { text: this.baseText, cls: "nn-modal-value nn-ruby-base-preview" });

    const inputWrap = contentEl.createEl("div", { cls: "nn-modal-input-wrap" });
    inputWrap.createEl("label", { text: "ルビ（読み仮名）", cls: "nn-modal-field-label" });
    const input = inputWrap.createEl("input", {
      type: "text",
      placeholder: "ふりがなを入力",
      cls: "nn-modal-input",
    });

    // プレビュー
    const previewWrap = contentEl.createEl("div", { cls: "nn-ruby-preview-wrap" });
    previewWrap.createEl("span", { text: "プレビュー：", cls: "nn-modal-label" });
    const preview = previewWrap.createEl("ruby", { cls: "nn-ruby-preview" });
    preview.appendChild(window.document.createTextNode(this.baseText));
    const rt = preview.createEl("rt");
    rt.textContent = "";

    input.addEventListener("input", () => {
      rt.textContent = input.value;
    });

    const btnRow = contentEl.createEl("div", { cls: "nn-modal-btn-row" });
    const cancelBtn = btnRow.createEl("button", {
      text: "キャンセル",
      cls: "nn-modal-btn nn-modal-btn-cancel",
    });
    const insertBtn = btnRow.createEl("button", {
      text: "挿入",
      cls: "nn-modal-btn nn-modal-btn-create",
    });

    const submit = () => {
      const ruby = input.value.trim();
      if (!ruby) {
        input.addClass("nn-modal-input-error");
        input.focus();
        return;
      }
      this.close();
      this.onSubmit(buildRubyText(this.baseText, ruby, this.style));
    };

    input.addEventListener("keydown", (e: KeyboardEvent) => {
      // モーダル内でのキー操作を「ルビ挿入」または「モーダルを閉じる」
      // だけに留める。preventDefault/stopPropagation を呼ばないと、
      // Enter キーがモーダルの外（下layerのCodeMirrorエディタ）にも
      // 届いてしまい、ルビ挿入と同時に本文が改行される原因になる。
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        submit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        this.close();
      }
    });
    cancelBtn.addEventListener("click", () => this.close());
    insertBtn.addEventListener("click", submit);

    this.focusTimer = window.setTimeout(() => input.focus(), 50);
  }

  onClose(): void {
    if (this.focusTimer !== undefined) window.clearTimeout(this.focusTimer);
    this.contentEl.empty();
  }
}

// ─────────────────────────────────────────
// コマンド登録（ルビ・傍点）
//
// editor-menu（右クリックメニュー）はモバイルでは呼び出す手段が
// 存在しない（長押しは contextmenu を発火せず、Obsidian 側にも
// editor-menu 相当を開く標準UIがない）ため、同じ挿入ロジックを
// コマンドとしても公開する。モバイルでは選択テキストを作った上で
// 「ツールバーをカスタマイズ」に登録すれば実行できる。
// デスクトップでも右クリックメニューと併用でき、ホットキーを
// 割り当てて使うことも可能。
// ─────────────────────────────────────────
export function registerRubyCommands(
  plugin: {
    addCommand: (command: {
      id: string;
      name: string;
      editorCallback: (editor: Editor) => void;
    }) => void;
  },
  app: App,
  getSettings: () => NovelsNoteSettings
): void {
  plugin.addCommand({
    id: "insert-ruby-on-selection",
    name: "選択した文字列にルビを振る",
    editorCallback: (editor: Editor) => {
      const selected = editor.getSelection();
      if (!selected || selected.length === 0) {
        new Notice("ルビを振る文字列を選択してください。");
        return;
      }
      const settings = getSettings();
      new RubyInputModal(app, selected, settings.rubyStyle, (rubyText: string) => {
        editor.replaceSelection(rubyText);
        new Notice(`ルビを挿入しました。`);
      }).open();
    },
  });

  plugin.addCommand({
    id: "insert-bouten-on-selection",
    name: "選択した文字列に傍点を振る",
    editorCallback: (editor: Editor) => {
      const selected = editor.getSelection();
      if (!selected || selected.length === 0) {
        new Notice("傍点を振る文字列を選択してください。");
        return;
      }
      const settings = getSettings();
      const boutenText = buildBoutenText(selected, settings.rubyStyle);
      editor.replaceSelection(boutenText);
      new Notice(`傍点を挿入しました。`);
    },
  });
}

// ─────────────────────────────────────────
// editor-menu イベントハンドラ登録
//
// Plugin.registerEvent で呼んでもらうため、
// コールバック関数を返す形にする。
// ─────────────────────────────────────────
export function onEditorMenuForRuby(
  app: App,
  getSettings: () => NovelsNoteSettings,
  menu: Menu,
  editor: Editor,
  _info: MarkdownView
): void {
  const selected = editor.getSelection();

  // 選択がなければメニューに追加しない
  if (!selected || selected.length === 0) return;

  menu.addSeparator();
  menu.addItem(item => {
    item
      .setTitle("ルビを振る")
      .setIcon("text-cursor-input")
      .onClick(() => {
        const settings = getSettings();
        new RubyInputModal(app, selected, settings.rubyStyle, (rubyText: string) => {
          editor.replaceSelection(rubyText);
          new Notice(`ルビを挿入しました。`);
        }).open();
      });
  });
  menu.addItem(item => {
    item
      .setTitle("傍点を振る")
      .setIcon("dot")
      .onClick(() => {
        const settings = getSettings();
        const boutenText = buildBoutenText(selected, settings.rubyStyle);
        editor.replaceSelection(boutenText);
        new Notice(`傍点を挿入しました。`);
      });
  });
}
