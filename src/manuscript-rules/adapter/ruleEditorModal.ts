// ─────────────────────────────────────────
// manuscript-rules — 定義ファイル編集モーダル
//
// ManuscriptRulesDefinition の各要素ルールを、ドロップダウン形式の
// UIで編集する。ユーザーがJSONを直接編集することを前提にせず、
// 「UIからのみ編集する」設計方針（設計書 v0.3 §31・§44）に沿う。
//
// このファイルも pluginRuleStore.ts と同様、唯一 Obsidian の Modal /
// Setting コンポーネントに依存する「薄い glue」であり、
// Novels Bookcrafter 側でも adapter/ フォルダごとコピーして使う想定。
// ─────────────────────────────────────────

import { App, Modal, Setting } from "obsidian";
import type {
  ManuscriptRulesDefinition,
  ManuscriptRules,
  SimpleRule,
  EditableRule,
  WikilinkRule,
  RubyRule,
  BlankLinesRule,
  TrailingWhitespaceRule,
  KeepRemoveAction,
  KeepRemoveEditAction,
} from "../types/rules";

export class RuleEditorModal extends Modal {
  private def: ManuscriptRulesDefinition;
  private readonly onSave: (def: ManuscriptRulesDefinition) => void | Promise<void>;
  private dirty = false;

  constructor(
    app: App,
    def: ManuscriptRulesDefinition,
    onSave: (def: ManuscriptRulesDefinition) => void | Promise<void>
  ) {
    super(app);
    // 呼び出し元のオブジェクトを直接書き換えないよう複製する
    this.def = JSON.parse(JSON.stringify(def)) as ManuscriptRulesDefinition;
    this.onSave = onSave;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("nn-rule-editor-modal");

    contentEl.createEl("h2", { text: `原稿クリーニング定義の編集${this.def.name ? `：${this.def.name}` : ""}` });

    const rules: ManuscriptRules = this.def.rules;
    rules.metadata ??= {};
    rules.block ??= {};
    rules.inline ??= {};
    rules.document ??= {};

    // ── 名前 ──────────────────────────────────
    new Setting(contentEl)
      .setName("表示名")
      .setDesc("この定義ファイルの一覧表示に使う任意のラベルです。")
      .addText(text =>
        text.setPlaceholder("（未設定）").setValue(this.def.name ?? "")
          .onChange(value => {
            this.def.name = value.trim() || undefined;
            this.dirty = true;
          })
      );

    // ── メタデータ ────────────────────────────
    const metaSection = contentEl.createDiv();
    metaSection.createEl("h3", { text: "メタデータ" });
    this.addSimpleRuleSetting(metaSection, "Frontmatter", () => rules.metadata!.frontmatter, v => rules.metadata!.frontmatter = v);

    // ── ブロック要素 ──────────────────────────
    const blockSection = contentEl.createDiv();
    blockSection.createEl("h3", { text: "ブロック要素" });
    this.addSimpleRuleSetting(blockSection, "コメント（%%...%%）", () => rules.block!.comment, v => rules.block!.comment = v);
    this.addEditableRuleSetting(blockSection, "Callout（> [!note] ...）", () => rules.block!.callout, v => rules.block!.callout = v);
    this.addEditableRuleSetting(blockSection, "見出し（# ...）", () => rules.block!.heading, v => rules.block!.heading = v);
    this.addEditableRuleSetting(blockSection, "引用（> ...）", () => rules.block!.blockquote, v => rules.block!.blockquote = v);
    this.addEditableRuleSetting(blockSection, "リスト（- / 1. ...）", () => rules.block!.list, v => rules.block!.list = v);
    this.addEditableRuleSetting(blockSection, "コードブロック（``` ... ```）", () => rules.block!.codeBlock, v => rules.block!.codeBlock = v);
    this.addSimpleRuleSetting(blockSection, "水平線（---）", () => rules.block!.horizontalRule, v => rules.block!.horizontalRule = v);
    this.addSimpleRuleSetting(blockSection, "HTMLタグ（行全体がタグのみの行）", () => rules.block!.html, v => rules.block!.html = v);

    // ── インライン要素 ────────────────────────
    const inlineSection = contentEl.createDiv();
    inlineSection.createEl("h3", { text: "インライン要素" });
    this.addWikilinkRuleSetting(inlineSection, () => rules.inline!.wikilink, v => rules.inline!.wikilink = v);
    this.addSimpleRuleSetting(inlineSection, "タグ（#タグ名）", () => rules.inline!.tag, v => rules.inline!.tag = v);
    this.addEditableRuleSetting(inlineSection, "強調（*斜体* / **太字**）", () => rules.inline!.emphasis, v => rules.inline!.emphasis = v);
    this.addEditableRuleSetting(inlineSection, "Markdownリンク（[text](url)）", () => rules.inline!.markdownLink, v => rules.inline!.markdownLink = v);
    this.addSimpleRuleSetting(inlineSection, "画像（![alt](url)）", () => rules.inline!.image, v => rules.inline!.image = v);
    this.addRubyRuleSetting(inlineSection, () => rules.inline!.ruby, v => rules.inline!.ruby = v);
    this.addEditableRuleSetting(inlineSection, "インラインコード（`code`）", () => rules.inline!.inlineCode, v => rules.inline!.inlineCode = v);
    this.addSimpleRuleSetting(inlineSection, "HTMLタグ（本文中に混在するタグ）", () => rules.inline!.html, v => rules.inline!.html = v);

    // ── 文書全体 ──────────────────────────────
    const documentSection = contentEl.createDiv();
    documentSection.createEl("h3", { text: "文書全体の整形" });
    // blankLines は選択によって「圧縮する行数」の入力欄を出し分けるため
    // 専用のサブコンテナに分離し、再描画してもtrailingWhitespaceなど
    // 他の項目を巻き込んで消してしまわないようにする。
    const blankLinesContainer = documentSection.createDiv();
    this.addBlankLinesRuleSetting(blankLinesContainer, () => rules.document!.blankLines, v => rules.document!.blankLines = v);
    this.addTrailingWhitespaceRuleSetting(documentSection, () => rules.document!.trailingWhitespace, v => rules.document!.trailingWhitespace = v);

    // ── ボタン ────────────────────────────────
    const btnArea = contentEl.createDiv({ cls: "nn-rule-editor-buttons" });
    const saveBtn = btnArea.createEl("button", { text: "保存", cls: "mod-cta" });
    saveBtn.addEventListener("click", () => { void this.save(); });
    const cancelBtn = btnArea.createEl("button", { text: "キャンセル" });
    cancelBtn.addEventListener("click", () => this.close());
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private async save(): Promise<void> {
    await this.onSave(this.def);
    this.close();
  }

  // ─────────────────────────────────────────
  // 各ルール種別ごとのUI構築ヘルパー
  // ─────────────────────────────────────────

  private addSimpleRuleSetting(
    container: HTMLElement,
    label: string,
    get: () => SimpleRule | undefined,
    set: (v: SimpleRule) => void,
    desc?: string
  ): void {
    const current = get() ?? { action: "keep" as KeepRemoveAction };
    const setting = new Setting(container).setName(label);
    if (desc) setting.setDesc(desc);
    setting.addDropdown(drop => {
      drop.addOption("keep", "そのまま維持");
      drop.addOption("remove", "削除する");
      drop.setValue(current.action);
      drop.onChange(value => {
        set({ action: value as KeepRemoveAction });
        this.dirty = true;
      });
    });
  }

  private addEditableRuleSetting(
    container: HTMLElement,
    label: string,
    get: () => EditableRule | undefined,
    set: (v: EditableRule) => void
  ): void {
    const current = get() ?? { action: "keep" as KeepRemoveEditAction };
    new Setting(container).setName(label).addDropdown(drop => {
      drop.addOption("keep", "そのまま維持");
      drop.addOption("remove", "削除する（中身ごと）");
      drop.addOption("edit", "記法だけ外して中身を残す");
      drop.setValue(current.action);
      drop.onChange(value => {
        set({ action: value as KeepRemoveEditAction });
        this.dirty = true;
      });
    });
  }

  // 選択によって表示すべき追加項目（例：blankLinesのnormalize選択時の
  // maxConsecutive入力欄）が変わる場合に、そのセクションだけ簡易的に
  // 再描画するためのヘルパー（モーダル全体は再構築しない）。
  private refreshSection(container: HTMLElement, rerender: () => void): void {
    container.empty();
    rerender();
  }

  private addWikilinkRuleSetting(
    container: HTMLElement,
    get: () => WikilinkRule | undefined,
    set: (v: WikilinkRule) => void
  ): void {
    const current: WikilinkRule = get() ?? { action: "keep" };
    new Setting(container)
      .setName("Wikilink（[[ページ名]]）")
      .addDropdown(drop => {
        drop.addOption("keep", "そのまま維持");
        drop.addOption("remove", "削除する（中身ごと）");
        drop.addOption("fileName", "ファイル名を残す（エイリアス無視）");
        drop.addOption("displayText", "表示名を残す（エイリアス優先）");
        const initial =
          current.action === "edit" ? (current.editMode ?? "displayText") : current.action;
        drop.setValue(initial);
        drop.onChange(value => {
          if (value === "keep" || value === "remove") {
            set({ action: value });
          } else {
            set({ action: "edit", editMode: value as "fileName" | "displayText" });
          }
          this.dirty = true;
        });
      });
  }

  private addRubyRuleSetting(
    container: HTMLElement,
    get: () => RubyRule | undefined,
    set: (v: RubyRule) => void
  ): void {
    const current: RubyRule = get() ?? { mode: "none" };
    new Setting(container).setName("ルビ").addDropdown(drop => {
      drop.addOption("none", "変換しない（そのまま維持）");
      drop.addOption("remove", "ルビ記号を削除（親文字のみ残す）");
      drop.addOption("narou", "なろう式に変換（|漢字《ルビ》）");
      drop.addOption("aozora", "青空文庫式に変換（｜漢字《ルビ》）");
      drop.addOption("denden", "でんでん式に変換（{漢字|ルビ}）");
      drop.addOption("html", "HTMLタグに変換（<ruby>）");
      drop.setValue(current.mode);
      drop.onChange(value => {
        set({ mode: value as RubyRule["mode"] });
        this.dirty = true;
      });
    });
  }

  private addBlankLinesRuleSetting(
    container: HTMLElement,
    get: () => BlankLinesRule | undefined,
    set: (v: BlankLinesRule) => void
  ): void {
    const current: BlankLinesRule = get() ?? { action: "keep" };
    const setting = new Setting(container).setName("連続する空行");
    setting.addDropdown(drop => {
      drop.addOption("keep", "そのまま維持");
      drop.addOption("normalize", "指定行数まで圧縮する");
      drop.setValue(current.action);
      drop.onChange(value => {
        if (value === "keep") {
          set({ action: "keep" });
        } else {
          set({ action: "normalize", maxConsecutive: 1 });
        }
        this.dirty = true;
        this.refreshSection(container, () => this.rerenderDocument(container, get, set));
      });
    });
    if (current.action === "normalize") {
      setting.addText(text =>
        text
          .setPlaceholder("1")
          .setValue(String(current.maxConsecutive ?? 1))
          .onChange(value => {
            const n = Math.max(0, Math.trunc(Number(value) || 0));
            set({ action: "normalize", maxConsecutive: n });
            this.dirty = true;
          })
      );
    }
  }

  private rerenderDocument(
    container: HTMLElement,
    get: () => BlankLinesRule | undefined,
    set: (v: BlankLinesRule) => void
  ): void {
    // container は blankLines 専用のサブコンテナのため、
    // 見出し（h3）やtrailingWhitespaceなど他の項目は含まれていない。
    this.addBlankLinesRuleSetting(container, get, set);
  }

  private addTrailingWhitespaceRuleSetting(
    container: HTMLElement,
    get: () => TrailingWhitespaceRule | undefined,
    set: (v: TrailingWhitespaceRule) => void
  ): void {
    const current: TrailingWhitespaceRule = get() ?? { action: "keep" };
    new Setting(container).setName("末尾の余分な空白・空行").addDropdown(drop => {
      drop.addOption("keep", "そのまま維持");
      drop.addOption("normalize", "除去して改行1つに揃える");
      drop.setValue(current.action);
      drop.onChange(value => {
        set({ action: value as "keep" | "normalize" });
        this.dirty = true;
      });
    });
  }
}
