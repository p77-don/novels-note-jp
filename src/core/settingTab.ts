// ─────────────────────────────────────────
// Novels Note JP — 設定タブ
// ─────────────────────────────────────────

import { App, PluginSettingTab, Setting, Platform, Notice, Modal } from "obsidian";
import NovelsNoteJP from "../main";
import { GLOSSARY_PALETTE_FORBIDDEN_TRIGGERS, GlossaryPaletteScope } from "../settings";

// ─────────────────────────────────────────
// 説明文（setDesc）を複数行に分けて表示するためのヘルパー
//
// Setting.setDesc() は string を渡すと単なるテキストノードとして
// 挿入されるため、"\n" や "<br>" をそのまま書いても改行されない
// （HTMLタグは自動エスケープされ、改行コードは空白として扱われる）。
// DocumentFragment を組み立てて渡すことで、意図した箇所で
// 確実に改行できる。
// ─────────────────────────────────────────
function descLines(...lines: string[]): DocumentFragment {
  return createFragment((frag) => {
    lines.forEach((line, i) => {
      if (i > 0) frag.createEl("br");
      frag.appendText(line);
    });
  });
}

// ─────────────────────────────────────────
// 汎用の確認ダイアログ
//
// Obsidian 1.13.0 以降には標準の ConfirmationModal があるが、
// minAppVersion（1.8.7）との互換性のため、独自に軽量な実装を用意する。
// ─────────────────────────────────────────
class ConfirmDialog extends Modal {
  constructor(
    app: App,
    private message: string,
    // 呼び出し側で async コールバック（履歴削除など await を伴う処理）を
    // 渡せるように、戻り値の型として void | Promise<void> の両方を許容する。
    private onConfirm: () => void | Promise<void>
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("p", { text: this.message });

    const btnRow = contentEl.createDiv({ cls: "nn-confirm-dialog-buttons" });

    const yesBtn = btnRow.createEl("button", { text: "はい", cls: "mod-warning" });
    yesBtn.addEventListener("click", () => {
      this.close();
      // onConfirm が Promise を返す場合でも、このイベントハンドラ自体は
      // void を返せば良いため、意図的に await せず切り離す
      // （no-misused-promises 対策）。エラーハンドリングは呼び出し側の
      // 各コールバック内で行う。
      void this.onConfirm();
    });

    const noBtn = btnRow.createEl("button", { text: "いいえ" });
    noBtn.addEventListener("click", () => this.close());
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export class NovelsNoteSettingTab extends PluginSettingTab {
  plugin: NovelsNoteJP;

  constructor(app: App, plugin: NovelsNoteJP) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    this.refresh();
  }

  private refresh(): void {
    const { containerEl } = this;

    // containerEl.empty() で画面全体を作り直すため、何もしないと
    // スクロール位置が先頭にリセットされてしまう（除外フォルダ・
    // カテゴリ定義・括弧定義などの追加/削除のたびに毎回スクロール
    // し直す必要があり手間だった）。再描画前後でスクロール位置を
    // 保存・復元することで、編集中の場所に留まれるようにする。
    const scrollTop = containerEl.scrollTop;

    containerEl.empty();

    this.renderEditorSection(containerEl);
    this.renderRulerSection(containerEl);
    this.renderRubySection(containerEl);
    this.renderVerticalPreviewSection(containerEl);
    this.renderFullWidthSpaceSection(containerEl);
    this.renderWordCountSection(containerEl);
    this.renderExcludeFoldersSection(containerEl);
    this.renderStatsExcludeFoldersSection(containerEl);
    this.renderReadingSpeedSection(containerEl);
    this.renderHighlightSection(containerEl);
    this.renderTagSection(containerEl);
    this.renderBracketSection(containerEl);
    this.renderGlossaryPaletteSection(containerEl);

    // 再描画直後のレイアウト確定タイミングによっては、同期的な
    // 代入だけでは反映されない場合があるため、次のフレームでも
    // 念のため設定し直す。
    containerEl.scrollTop = scrollTop;
    window.requestAnimationFrame(() => {
      containerEl.scrollTop = scrollTop;
    });
  }

  // ─────────────────────────────────────────
  // エディタ表示セクション
  // ─────────────────────────────────────────
  private renderEditorSection(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("エディタ表示").setHeading();

    new Setting(containerEl)
      .setName("フォントサイズ（px）")
      .setDesc("小説本文エディタのフォントサイズ。")
      .addText(text =>
        text.setValue(String(this.plugin.settings.fontSize))
          .onChange(async value => {
            const n = parseInt(value, 10);
            if (!isNaN(n) && n > 0) {
              this.plugin.settings.fontSize = n;
              await this.plugin.saveSettings();
              this.plugin.applyEditorStyles();
            }
          })
      );

    new Setting(containerEl)
      .setName("行間")
      .setDesc("行の高さを倍率で指定します（例：2.0）。")
      .addText(text =>
        text.setValue(String(this.plugin.settings.lineHeight))
          .onChange(async value => {
            const n = parseFloat(value);
            if (!isNaN(n) && n > 0) {
              this.plugin.settings.lineHeight = n;
              await this.plugin.saveSettings();
              this.plugin.applyEditorStyles();
            }
          })
      );

    new Setting(containerEl)
      .setName("折り返し文字数")
      .setDesc("1行に表示する全角文字数（例：40）。")
      .addText(text =>
        text.setValue(String(this.plugin.settings.wrapColumn))
          .onChange(async value => {
            const n = parseInt(value, 10);
            if (!isNaN(n) && n > 0) {
              this.plugin.settings.wrapColumn = n;
              await this.plugin.saveSettings();
              this.plugin.applyEditorStyles();
              this.plugin.refreshEditors();
            }
          })
      );
  }

  // ─────────────────────────────────────────
  // 折り返しガイドラインセクション
  // ─────────────────────────────────────────
  private renderRulerSection(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("折り返しガイドライン").setHeading();

    new Setting(containerEl)
      .setName("ガイドラインを表示する")
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.showRuler)
          .onChange(async value => {
            this.plugin.settings.showRuler = value;
            await this.plugin.saveSettings();
            this.plugin.refreshEditors();
          })
      );

    new Setting(containerEl)
      .setName("ガイドライン色")
      .addColorPicker(picker =>
        picker.setValue(this.plugin.settings.rulerColor)
          .onChange(async value => {
            this.plugin.settings.rulerColor = value;
            await this.plugin.saveSettings();
            this.plugin.applyEditorStyles();
          })
      );

    new Setting(containerEl)
      .setName("ガイドライン透明度")
      .setDesc("0.0（透明）〜 1.0（不透明）。")
      .addText(text =>
        text.setValue(String(this.plugin.settings.rulerOpacity))
          .onChange(async value => {
            const n = parseFloat(value);
            if (!isNaN(n) && n >= 0 && n <= 1) {
              this.plugin.settings.rulerOpacity = n;
              await this.plugin.saveSettings();
              this.plugin.applyEditorStyles();
            }
          })
      );

    new Setting(containerEl)
      .setName("ガイドラインスタイル")
      .addDropdown(drop =>
        drop.addOption("solid", "実線").addOption("dashed", "破線")
          .setValue(this.plugin.settings.rulerStyle)
          .onChange(async value => {
            this.plugin.settings.rulerStyle = value as "solid" | "dashed";
            await this.plugin.saveSettings();
            this.plugin.applyEditorStyles();
          })
      );
  }


  // ─────────────────────────────────────────
  // 縦書きプレビュー設定セクション
  // ─────────────────────────────────────────
  private renderVerticalPreviewSection(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("縦書きプレビュー").setHeading();

    // カーソル行ハイライトは「エディタと縦書きプレビューを同時に見ながら
    // 執筆する」ことが前提の機能。モバイルではエディタと縦書きプレビュー
    // （独立タブ）を同時に表示できず機能自体が意味を持たないため、
    // verticalPreview.ts 側で強制的に無効化している。
    //
    // ここでは項目自体を非表示にはしない。設定を非表示にすると、
    // PC版との見た目の不整合（この設定が存在すること自体が
    // 分からなくなる）が生じるため、項目は表示したまま
    // トグル・カラーピッカーを無効化し、理由を明記する。
    const isMobile = Platform.isMobile;

    new Setting(containerEl)
      .setName("カーソル行のハイライトを有効にする")
      .setDesc(
        isMobile
          ? "モバイルでは使用できません。"
          : "縦書きプレビューでエディタのカーソル行を背景色で強調します。"
      )
      .addToggle(toggle => {
        toggle.setValue(isMobile ? false : this.plugin.settings.verticalCursorHighlightEnabled);
        toggle.setDisabled(isMobile);
        if (!isMobile) {
          toggle.onChange(async value => {
            this.plugin.settings.verticalCursorHighlightEnabled = value;
            await this.plugin.saveSettings();
            this.plugin.applyEditorStyles();
          });
        }
      });

    new Setting(containerEl)
      .setName("カーソル行の背景色")
      .setDesc(
        isMobile
          ? "モバイルでは使用できません。"
          : "縦書きプレビューでカーソル位置の行に付ける背景色。"
      )
      .addColorPicker(picker => {
        picker.setValue(this.plugin.settings.verticalCursorHighlightColor);
        picker.setDisabled(isMobile);
        if (!isMobile) {
          picker.onChange(async value => {
            this.plugin.settings.verticalCursorHighlightColor = value;
            await this.plugin.saveSettings();
            this.plugin.applyEditorStyles();
          });
        }
      });
  }

  // ─────────────────────────────────────────
  // 全角スペース可視化セクション
  // ─────────────────────────────────────────
  private renderFullWidthSpaceSection(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("全角スペースと改行記号の表示").setHeading();
    containerEl.createEl("p", {
      text: "段落先頭の全角スペースと、行末の改行位置を目視で確認できます。",
      cls: "setting-item-description",
    });

    new Setting(containerEl)
      .setName("全角スペースを可視化する")
      .setDesc(descLines(
        "オンにすると全角スペース（\u3000）の位置を記号で表示します。",
        "あわせて行末に改行記号（↵）も表示します（オフにすると両方とも非表示になります）。",
        "※改行記号は幅を持たないため、折り返し位置には影響しません。"
      ))
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.showFullWidthSpace)
          .onChange(async value => {
            this.plugin.settings.showFullWidthSpace = value;
            await this.plugin.saveSettings();
            this.plugin.applyEditorStyles();
            this.plugin.refreshEditors();
          })
      );

    new Setting(containerEl)
      .setName("全角スペースの表示スタイル")
      .setDesc(descLines(
        "全角スペースの表示方法を選べます（改行記号の見た目には影響しません）。",
        "・ドット： 中央に薄いドットを重ねる",
        "・下線：アンダーラインで幅を示す",
        "・枠線： 薄い線で枠を囲む"
      ))
      .addDropdown(drop =>
        drop
          .addOption("dot",       "ドット（中央の点）")
          .addOption("underline", "下線")
          .addOption("box",       "枠線")
          .setValue(this.plugin.settings.fullWidthSpaceStyle === "none"
            ? "dot"
            : this.plugin.settings.fullWidthSpaceStyle)
          .onChange(async value => {
            this.plugin.settings.fullWidthSpaceStyle =
              value as "dot" | "underline" | "box";
            await this.plugin.saveSettings();
            this.plugin.applyEditorStyles();
            this.plugin.refreshEditors();
          })
      );

    new Setting(containerEl)
      .setName("表示色")
      .setDesc("全角スペースの記号・改行記号の色（エディタのテーマに合わせて調整してください）。")
      .addColorPicker(picker =>
        picker.setValue(this.plugin.settings.fullWidthSpaceColor)
          .onChange(async value => {
            this.plugin.settings.fullWidthSpaceColor = value;
            await this.plugin.saveSettings();
            this.plugin.applyEditorStyles();
            this.plugin.refreshEditors();
          })
      );
  }



  // ─────────────────────────────────────────
  // 用語インデックス除外フォルダ セクション
  //
  // Obsidian のグラフビューと同じ方式：
  // フォルダパスのプレフィックス一致で除外する。
  // 例）"_templates" を指定すると
  //     "_templates/character.md" が除外される。
  // ─────────────────────────────────────────
  private renderExcludeFoldersSection(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("用語インデックス — 除外フォルダ").setHeading();
    containerEl.createEl("p", {
      text:
        "指定したフォルダ内のファイルを用語インデックスから除外します。" +
        "テンプレートフォルダなどを指定してください。" +
        "フォルダパスは Vault ルートからの相対パスで入力します（例：_templates）。",
      cls: "setting-item-description",
    });

    // 現在の除外フォルダリストを描画
    this.renderExcludeFolderList(containerEl);

    // 追加フォーム：addText + addButton を並べる（Obsidian 標準方式）
    let folderInput = "";
    new Setting(containerEl)
      .setName("フォルダを追加")
      .setDesc(descLines(
        "Vault ルートからの相対パスを入力してください。",
        "（例：templates、characters/templates）"
        )
      )
      .addText(text => {
        text.setPlaceholder("フォルダパスを入力…");
        text.inputEl.addClass("nn-folder-path-input");
        text.onChange(value => { folderInput = value; });
        // Enter キーでも追加できる
        text.inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
          if (e.key === "Enter") {
            void this.addExcludeFolder(folderInput, containerEl).then(() => {
              text.setValue("");
              folderInput = "";
            });
          }
        });
      })
      .addButton(btn =>
        btn.setButtonText("追加").setCta()
          .onClick(() => {
            void this.addExcludeFolder(folderInput, containerEl).then(() => {
              folderInput = "";
              // テキストフィールドをクリア（再描画で反映）
              this.refresh();
            });
          })
      );
  }

  private renderExcludeFolderList(containerEl: HTMLElement): void {
    // 既存リストを削除して再描画
    containerEl.querySelectorAll(".nn-exclude-folder-row").forEach(el => el.remove());

    const folders = this.plugin.settings.excludeFolders ?? [];
    if (folders.length === 0) {
      const empty = containerEl.createEl("p", {
        text: "除外フォルダは設定されていません。",
        cls: "nn-exclude-folder-empty setting-item-description",
      });
      empty.addClass("nn-exclude-folder-row");
      return;
    }

    for (let i = 0; i < folders.length; i++) {
      const row = containerEl.createDiv({
        cls: "setting-item nn-exclude-folder-row",
      });
      row.addClass("nn-exclude-folder-item-row");

      // フォルダアイコン＋パス
      const label = row.createSpan({ cls: "setting-item-name nn-folder-label" });
      label.createSpan({ cls: "nn-folder-icon", text: "📁" });
      label.createEl("code", { text: folders[i] });

      // 削除ボタン
      const delBtn = row.createEl("button", { text: "削除", cls: "mod-warning nn-folder-del-btn" });
      delBtn.addEventListener("click", () => {
        this.plugin.settings.excludeFolders.splice(i, 1);
        void this.plugin.saveSettings().then(() => {
          void this.plugin.buildTermIndex();
          this.plugin.updateSidebar();
          this.plugin.refreshEditors();
          this.refresh();
        });
      });
    }
  }

  private async addExcludeFolder(value: string, _containerEl: HTMLElement): Promise<void> {
    const folder = value.trim().replace(/\/+$/, ""); // 末尾スラッシュを除去
    if (!folder) return;

    if (!this.plugin.settings.excludeFolders) {
      this.plugin.settings.excludeFolders = [];
    }

    // 重複チェック
    if (this.plugin.settings.excludeFolders.includes(folder)) return;

    this.plugin.settings.excludeFolders.push(folder);
    await this.plugin.saveSettings();
    await this.plugin.buildTermIndex();
    this.plugin.updateSidebar();
    this.plugin.refreshEditors();
    this.refresh(); // セクション全体を再描画
  }

  // ─────────────────────────────────────────
  // 執筆情報一覧 — 推定読了時間の読了速度設定
  // ─────────────────────────────────────────
  private renderReadingSpeedSection(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("執筆情報一覧 — 推定読了時間").setHeading();

    new Setting(containerEl)
      .setName("読了速度（字/分）")
      .setDesc(
        "「執筆情報一覧」に表示する推定読了時間の計算に使う読書速度の目安です。" +
        "小説換算文字数（全角1・半角0.5換算）を基準に計算します。" +
        "あくまで目安のため、実際の読了時間とは差が生じます。" +
        "変更後は「執筆情報一覧」タブの「再集計」（または開き直し）で反映されます。"
      )
      .addText(text =>
        text.setValue(String(this.plugin.settings.readingSpeedCharsPerMinute))
          .onChange(async value => {
            const n = parseInt(value, 10);
            if (!isNaN(n) && n > 0) {
              this.plugin.settings.readingSpeedCharsPerMinute = n;
              await this.plugin.saveSettings();
            }
          })
      );
  }

  // ─────────────────────────────────────────
  // 執筆情報一覧 — 除外フォルダ設定
  // ─────────────────────────────────────────
  private renderStatsExcludeFoldersSection(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("執筆情報一覧 — 除外フォルダ").setHeading();
    containerEl.createEl("p", {
      text:
        "指定したフォルダ内のファイルを「執筆情報一覧」の集計対象から除外します。" +
        "テンプレートフォルダなどを指定してください。" +
        "フォルダパスは Vault ルートからの相対パスで入力します（例：_templates）。" +
        "用語インデックスの除外フォルダとは別に管理されます。",
      cls: "setting-item-description",
    });

    // 現在の除外フォルダリストを描画
    this.renderStatsExcludeFolderList(containerEl);

    // 追加フォーム：addText + addButton を並べる（Obsidian 標準方式）
    let folderInput = "";
    new Setting(containerEl)
      .setName("フォルダを追加")
      .setDesc(descLines(
        "Vault ルートからの相対パスを入力してください。",
        "（例：templates、characters/templates）"
        )
      )
      .addText(text => {
        text.setPlaceholder("フォルダパスを入力…");
        text.inputEl.addClass("nn-folder-path-input");
        text.onChange(value => { folderInput = value; });
        // Enter キーでも追加できる
        text.inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
          if (e.key === "Enter") {
            void this.addStatsExcludeFolder(folderInput).then(() => {
              text.setValue("");
              folderInput = "";
            });
          }
        });
      })
      .addButton(btn =>
        btn.setButtonText("追加").setCta()
          .onClick(() => {
            void this.addStatsExcludeFolder(folderInput).then(() => {
              folderInput = "";
              this.refresh();
            });
          })
      );
  }

  private renderStatsExcludeFolderList(containerEl: HTMLElement): void {
    // 既存リストを削除して再描画
    containerEl.querySelectorAll(".nn-stats-exclude-folder-row").forEach(el => el.remove());

    const folders = this.plugin.settings.statsExcludeFolders ?? [];
    if (folders.length === 0) {
      const empty = containerEl.createEl("p", {
        text: "除外フォルダは設定されていません。",
        cls: "nn-stats-exclude-folder-empty setting-item-description",
      });
      empty.addClass("nn-stats-exclude-folder-row");
      return;
    }

    for (let i = 0; i < folders.length; i++) {
      const row = containerEl.createDiv({
        cls: "setting-item nn-stats-exclude-folder-row",
      });
      row.addClass("nn-exclude-folder-item-row");

      // フォルダアイコン＋パス
      const label = row.createSpan({ cls: "setting-item-name nn-folder-label" });
      label.createSpan({ cls: "nn-folder-icon", text: "📁" });
      label.createEl("code", { text: folders[i] });

      // 削除ボタン
      const delBtn = row.createEl("button", { text: "削除", cls: "mod-warning nn-folder-del-btn" });
      delBtn.addEventListener("click", () => {
        this.plugin.settings.statsExcludeFolders.splice(i, 1);
        void this.plugin.saveSettings().then(() => {
          this.refresh();
        });
      });
    }
  }

  private async addStatsExcludeFolder(value: string): Promise<void> {
    const folder = value.trim().replace(/\/+$/, ""); // 末尾スラッシュを除去
    if (!folder) return;

    if (!this.plugin.settings.statsExcludeFolders) {
      this.plugin.settings.statsExcludeFolders = [];
    }

    // 重複チェック
    if (this.plugin.settings.statsExcludeFolders.includes(folder)) return;

    this.plugin.settings.statsExcludeFolders.push(folder);
    await this.plugin.saveSettings();
    this.refresh(); // セクション全体を再描画
  }

  // ─────────────────────────────────────────
  // ハイライト全体のオン/オフセクション
  // ─────────────────────────────────────────
  private renderHighlightSection(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("ハイライト").setHeading();

    new Setting(containerEl)
      .setName("ハイライトを有効にする")
      .setDesc("オフにするとすべてのハイライトが無効になります。")
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.highlightEnabled)
          .onChange(async value => {
            this.plugin.settings.highlightEnabled = value;
            await this.plugin.saveSettings();
            this.plugin.applyEditorStyles();
            this.plugin.refreshEditors();
          })
      );

    new Setting(containerEl)
      .setName("用語ハイライトのホバープレビュー")
      .setDesc(descLines(
        "エディタ上でハイライトされた用語にマウスを合わせると、対応する用語ノートを" +
        "Obsidian標準のページプレビュー（Hover Preview）で表示します。" ,
        "※WikiLinkを書く必要はありません。")
      )
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.termHoverPreviewEnabled)
          .onChange(async value => {
            this.plugin.settings.termHoverPreviewEnabled = value;
            await this.plugin.saveSettings();
            this.plugin.applyEditorStyles();
          })
      );
  }

  // ─────────────────────────────────────────
  // カテゴリ定義セクション
  // ─────────────────────────────────────────
  private renderTagSection(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("カテゴリ定義").setHeading();
    containerEl.createEl("p", {
      text: "用語ノートに付けるカテゴリ名・表示名・色・オン/オフを設定します。",
      cls: "setting-item-description",
    });
    this.renderTagList(containerEl);
    new Setting(containerEl)
      .addButton(btn =>
        btn.setButtonText("＋ カテゴリを追加").setCta()
          .onClick(async () => {
            this.plugin.settings.tagDefinitions.push({
              tag: "new-tag", label: "新しいカテゴリ", color: "#aaaaaa", enabled: true,
            });
            await this.plugin.saveSettings();
            this.plugin.applyEditorStyles();
            this.refresh();
          })
      );
  }

  private renderTagList(containerEl: HTMLElement): void {
    const defs = this.plugin.settings.tagDefinitions;

    // ─── ドラッグ状態管理 ───
    let dragSrcIdx = -1;

    const saveAndRefresh = async () => {
      await this.plugin.saveSettings();
      this.plugin.applyEditorStyles();
      await this.plugin.buildTermIndex();
      this.plugin.updateSidebar();
      this.plugin.refreshEditors();
    };

    for (let i = 0; i < defs.length; i++) {
      const td = defs[i];

      // ── 行コンテナ（draggable） ─────────────────────
      const rowEl = containerEl.createDiv({ cls: "novels-note-tag-row nn-drag-row" });
      rowEl.setAttribute("draggable", "true");
      rowEl.dataset.idx = String(i);

      // ── ドラッグハンドル ────────────────────────────
      const handle = rowEl.createSpan({ cls: "nn-drag-handle", title: "ドラッグして並べ替え" });
      const svg = handle.createSvg("svg", { attr: { viewBox: "0 0 16 16", width: "16", height: "16" } });
      for (const [cx, cy] of [[5,4],[11,4],[5,8],[11,8],[5,12],[11,12]]) {
        svg.createSvg("circle", { attr: { cx, cy, r: "1.2", fill: "currentColor" } });
      }

      // ── Setting をこの rowEl の中に作る ────────────
      const setting = new Setting(rowEl);
      setting.settingEl.addClass("nn-tag-setting-row");

      const capturedI = i; // クロージャ用

      setting.addText(text =>
        text.setPlaceholder("カテゴリ名").setValue(td.tag)
          .onChange(async value => {
            defs[capturedI].tag = value.trim();
            await saveAndRefresh();
          })
      );
      setting.addText(text =>
        text.setPlaceholder("表示名").setValue(td.label)
          .onChange(async value => {
            defs[capturedI].label = value;
            await this.plugin.saveSettings();
            this.plugin.updateSidebar();
          })
      );

      // 狭い画面では「カテゴリ名・表示名」を1行目、
      // 「カラー・トグル・上下移動・削除」を2行目にまとめて
      // 折り返したいので、ここに強制改行用のスペーサーを挟む。
      // 通常幅では flex-basis: 0 で何も影響しない（styles.css参照）。
      setting.controlEl.createDiv({ cls: "nn-row-break" });

      setting.addColorPicker(picker =>
        picker.setValue(td.color)
          .onChange(async value => {
            defs[capturedI].color = value;
            await this.plugin.saveSettings();
            this.plugin.applyEditorStyles();
            this.plugin.refreshEditors();
          })
      );
      setting.addToggle(toggle =>
        toggle.setTooltip("ハイライトのオン/オフ").setValue(td.enabled)
          .onChange(async value => {
            defs[capturedI].enabled = value;
            await this.plugin.saveSettings();
            this.plugin.refreshEditors();
          })
      );

      // ── 上下移動ボタン ──────────────────────────────
      setting.addExtraButton(btn =>
        btn.setIcon("arrow-up").setTooltip("上へ移動")
          .onClick(async () => {
            if (capturedI === 0) return;
            [defs[capturedI - 1], defs[capturedI]] = [defs[capturedI], defs[capturedI - 1]];
            await saveAndRefresh();
            this.refresh();
          })
      );
      setting.addExtraButton(btn =>
        btn.setIcon("arrow-down").setTooltip("下へ移動")
          .onClick(async () => {
            if (capturedI === defs.length - 1) return;
            [defs[capturedI], defs[capturedI + 1]] = [defs[capturedI + 1], defs[capturedI]];
            await saveAndRefresh();
            this.refresh();
          })
      );
      setting.addExtraButton(btn =>
        btn.setIcon("trash").setTooltip("このカテゴリを削除")
          .onClick(async () => {
            defs.splice(capturedI, 1);
            await saveAndRefresh();
            this.refresh();
          })
      );

      // ── HTML5 Drag & Drop ───────────────────────────
      rowEl.addEventListener("dragstart", (e: DragEvent) => {
        dragSrcIdx = capturedI;
        rowEl.addClass("nn-drag-dragging");
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", String(capturedI));
        }
      });

      rowEl.addEventListener("dragend", () => {
        rowEl.removeClass("nn-drag-dragging");
        // ドロップ先のハイライトを全消去
        containerEl.querySelectorAll(".nn-drag-over").forEach(el =>
          el.removeClass("nn-drag-over")
        );
      });

      rowEl.addEventListener("dragover", (e: DragEvent) => {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
        // 自分以外にホバー表示
        containerEl.querySelectorAll(".nn-drag-over").forEach(el =>
          el.removeClass("nn-drag-over")
        );
        if (dragSrcIdx !== capturedI) rowEl.addClass("nn-drag-over");
      });

      rowEl.addEventListener("dragleave", () => {
        rowEl.removeClass("nn-drag-over");
      });

      rowEl.addEventListener("drop", (e: DragEvent) => {
        e.preventDefault();
        rowEl.removeClass("nn-drag-over");
        const src = dragSrcIdx;
        const dst = capturedI;
        if (src === dst || src < 0) return;

        // src を dst の位置に移動
        const [removed] = defs.splice(src, 1);
        defs.splice(dst, 0, removed);
        dragSrcIdx = -1;

        void saveAndRefresh().then(() => this.refresh());
      });
    }
  }

  // ─────────────────────────────────────────
  // カッコハイライトセクション
  // ─────────────────────────────────────────
  private renderBracketSection(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("カッコハイライト").setHeading();
    containerEl.createEl("p", {
      text: "内側のカッコが外側より優先されます。用語の強調表示はすべてのカッコより優先されます。",
      cls: "setting-item-description",
    });
    this.renderBracketList(containerEl);
    new Setting(containerEl)
      .addButton(btn =>
        btn.setButtonText("＋ カッコを追加").setCta()
          .onClick(async () => {
            const newId = `bracket-${Date.now()}`;
            this.plugin.settings.bracketDefinitions.push({
              id: newId, label: "新しいカッコ",
              open: "〔", close: "〕", color: "#aaaaaa", enabled: false,
            });
            await this.plugin.saveSettings();
            this.plugin.applyEditorStyles();
            this.refresh();
          })
      );
  }

  private renderBracketList(containerEl: HTMLElement): void {
    const defs = this.plugin.settings.bracketDefinitions;
    for (let i = 0; i < defs.length; i++) {
      const bd = defs[i];
      const setting = new Setting(containerEl);
      setting.settingEl.addClass("novels-note-bracket-row");
      setting.addText(text => {
        text.inputEl.addClass("nn-bracket-label-input");
        text.setPlaceholder("表示名").setValue(bd.label)
          .onChange(async value => {
            defs[i].label = value;
            await this.plugin.saveSettings();
          });
      });
      setting.addText(text => {
        text.inputEl.addClass("nn-bracket-char-input");
        text.setPlaceholder("開").setValue(bd.open)
          .onChange(async value => {
            defs[i].open = value;
            await this.plugin.saveSettings();
            this.plugin.refreshEditors();
          });
      });
      setting.addText(text => {
        text.inputEl.addClass("nn-bracket-char-input");
        text.setPlaceholder("閉").setValue(bd.close)
          .onChange(async value => {
            defs[i].close = value;
            await this.plugin.saveSettings();
            this.plugin.refreshEditors();
          });
      });

      // カテゴリ定義行と同様、狭い画面では「表示名・開始カッコ・
      // 終了カッコ」を1行目、「カラー・トグル・削除」を2行目に
      // まとめて折り返したいので、強制改行用のスペーサーを挟む。
      setting.controlEl.createDiv({ cls: "nn-row-break" });

      setting.addColorPicker(picker =>
        picker.setValue(bd.color)
          .onChange(async value => {
            defs[i].color = value;
            await this.plugin.saveSettings();
            this.plugin.applyEditorStyles();
            this.plugin.refreshEditors();
          })
      );
      setting.addToggle(toggle =>
        toggle.setTooltip("ハイライトのオン/オフ").setValue(bd.enabled)
          .onChange(async value => {
            defs[i].enabled = value;
            await this.plugin.saveSettings();
            this.plugin.refreshEditors();
          })
      );
      setting.addExtraButton(btn =>
        btn.setIcon("trash").setTooltip("このカッコを削除")
          .onClick(async () => {
            defs.splice(i, 1);
            await this.plugin.saveSettings();
            this.plugin.applyEditorStyles();
            this.plugin.refreshEditors();
            this.refresh();
          })
      );
    }
  }

  // ─────────────────────────────────────────
  // ルビ設定セクション
  // ─────────────────────────────────────────
  private renderRubySection(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("ルビ設定").setHeading();
    containerEl.createEl("p", {
      text: "縦書きプレビューおよびExportで使用するルビの記法を選択してください。",
      cls: "setting-item-description",
    });

    new Setting(containerEl)
      .setName("ルビの記法")
      .setDesc(descLines(
        "・なろう式：漢字《ルビ》 または |漢字《ルビ》（半角縦棒）",
        "・青空文庫式：漢字《ルビ》 または ｜漢字《ルビ》（全角縦棒）",
        "・でんでん式：{漢字|ルビ}",
        "・HTMLタグ：<ruby>漢字<rt>ルビ</rt></ruby>"
      ))
      .addDropdown(drop =>
        drop
          .addOption("narou",  "なろう式（漢字《ルビ》 / |漢字《ルビ》）")
          .addOption("aozora", "青空文庫式（漢字《ルビ》 / ｜漢字《ルビ》）")
          .addOption("denden", "でんでん式（{漢字|ルビ}）")
          .addOption("html",   "HTMLタグ（<ruby>）")
          .setValue(this.plugin.settings.rubyStyle)
          .onChange(async value => {
            this.plugin.settings.rubyStyle = value as "narou" | "aozora" | "denden" | "html";
            await this.plugin.saveSettings();
            // 縦書きプレビューを開いていれば即時反映
            this.plugin.refreshVerticalPreview();
          })
      );
  }

  // ─────────────────────────────────────────
  // 文字数カウントセクション
  // ─────────────────────────────────────────
  private renderWordCountSection(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("文字数カウント").setHeading();
    containerEl.createEl("p", {
      text: "ステータスバー（画面下部）に原稿の文字数を表示します。クリックでモードを切り替えられます。",
      cls: "setting-item-description",
    });

    new Setting(containerEl)
      .setName("カウントモード")
      .setDesc(descLines(
        "raw: 文字数そのまま",
        "novel: 全角1字・半角0.5字で換算",
        "manuscript: 400字詰め原稿用紙の枚数"
      ))
      .addDropdown(drop =>
        drop
          .addOption("raw",        "raw（文字数）")
          .addOption("novel",      "novel（小説換算）")
          .addOption("manuscript", "manuscript（原稿用紙換算）")
          .setValue(this.plugin.settings.countMode)
          .onChange(async value => {
            this.plugin.settings.countMode = value as "raw" | "novel" | "manuscript";
            await this.plugin.saveSettings();
            this.plugin.updateWordCount();
          })
      );

    new Setting(containerEl)
      .setName("全角スペースを文字数に含める")
      .setDesc(descLines(
        "オンにすると段落先頭などの全角スペース（　）も1文字としてカウントします。",
        "オフ（デフォルト）にすると除外します。"
      ))
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.countFullWidthSpace)
          .onChange(async value => {
            this.plugin.settings.countFullWidthSpace = value;
            await this.plugin.saveSettings();
            this.plugin.updateWordCount();
          })
      );

    new Setting(containerEl)
      .setName("空行を文字数に含める")
      .setDesc(descLines(
        "オンにすると内容のない行（空行）の改行文字もカウント対象にします。",
        "通常はオフ（デフォルト）のままで構いません。"
      ))
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.countEmptyLines)
          .onChange(async value => {
            this.plugin.settings.countEmptyLines = value;
            await this.plugin.saveSettings();
            this.plugin.updateWordCount();
          })
      );

    new Setting(containerEl)
      .setName("#tag を文字数に含める")
      .setDesc(descLines(
        "オンにすると原稿中に書いた #tag（キャラクター登録などの目印）も文字数としてカウントします。",
        "オフ（デフォルト）にすると #tag を除外します（エクスポート時の除去と同じ扱いになります）。"
      ))
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.countHashtags)
          .onChange(async value => {
            this.plugin.settings.countHashtags = value;
            await this.plugin.saveSettings();
            this.plugin.updateWordCount();
          })
      );
  }

  // ─────────────────────────────────────────
  // 用語入力パレットセクション
  // ─────────────────────────────────────────
  private renderGlossaryPaletteSection(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("用語入力パレット").setHeading();
    containerEl.createEl("p", {
      text: "執筆中にトリガー文字を入力すると、用語インデックスから用語を検索・入力できるパレットを開きます。",
      cls: "setting-item-description",
    });

    new Setting(containerEl)
      .setName("用語入力パレットを有効にする")
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.glossaryPaletteEnabled)
          .onChange(async value => {
            this.plugin.settings.glossaryPaletteEnabled = value;
            await this.plugin.saveSettings();
            this.plugin.refreshEditors();
          })
      );

    new Setting(containerEl)
      .setName("起動範囲")
      .setDesc(descLines(
        "・原稿ノートのみ：mode: novel が設定されたノートでのみ起動します。",
        "・原稿ノート＋用語ノート（デフォルト）：原稿ノートに加えて、用語ノート（キャラクター・場所などのタグを持つノート）でも起動します。",
        "・すべてのノート：全てのMarkdownノートで起動します。メモ等で普段からトリガー文字を書く場合は誤爆しやすいのでご注意ください。"
      ))
      .addDropdown(drop =>
        drop
          .addOption("novelOnly", "原稿ノートのみ")
          .addOption("novelAndGlossary", "原稿ノート＋用語ノート")
          .addOption("all", "すべてのノート")
          .setValue(this.plugin.settings.glossaryPaletteScope)
          .onChange(async value => {
            this.plugin.settings.glossaryPaletteScope = value as GlossaryPaletteScope;
            await this.plugin.saveSettings();
            this.plugin.refreshEditors();
          })
      );

    new Setting(containerEl)
      .setName("起動トリガー文字")
      .setDesc(descLines(
        "パレットを開くための1文字を指定してください（例： / @ $ : ;）。",
        `Markdownで一般的に使われる ${GLOSSARY_PALETTE_FORBIDDEN_TRIGGERS.join(" ")} は指定できません。`
      ))
      .addText(text =>
        text.setValue(this.plugin.settings.glossaryPaletteTrigger)
          .setPlaceholder("/")
          .onChange(async value => {
            const trimmed = value.trim();

            // 入力途中（削除中など）で空文字になった瞬間は
            // 何もせず待つ（通知を出すと入力操作のたびにうるさい）
            if (trimmed.length === 0) return;

            if (trimmed.length !== 1) {
              new Notice("トリガー文字は1文字で指定してください。");
              return;
            }
            if (GLOSSARY_PALETTE_FORBIDDEN_TRIGGERS.includes(trimmed)) {
              new Notice(`「${trimmed}」はMarkdown記法と衝突するため使用できません。`);
              return;
            }

            this.plugin.settings.glossaryPaletteTrigger = trimmed;
            await this.plugin.saveSettings();
            this.plugin.refreshEditors();
          })
      );

    new Setting(containerEl)
      .setName("「最近使った」履歴をクリア")
      .setDesc("用語入力パレットの「最近使った」に表示される履歴をすべて削除します。この操作は取り消せません。")
      .addButton(btn =>
        btn.setButtonText("クリア")
          // setDestructive() は @since 1.13.0 のAPIであり、実行時に
          // typeof で存在チェックするガードを書いても、Obsidianの
          // コミュニティプラグイン審査の静的解析（obsidianmd/no-unsupported-api）
          // はソースコード上の API 参照そのものを検出してエラーとするため
          // 通過できない（実際に obsidianmd/no-unsupported-api で
          // エラーになることを確認済み）。
          // minAppVersion（1.8.7）を引き上げない方針である以上、
          // setDestructive() への参照自体をコードに含めることができない。
          // setWarning() は非推奨だが廃止はされておらず動作するため、
          // こちらのみを使用する（審査では「警告」扱いに留まり、
          // 登録のブロッカーにはならない）。
          .setWarning()
          .onClick(() => {
            new ConfirmDialog(
              this.app,
              "「最近使った」履歴をすべて削除します。よろしいですか？",
              async () => {
                await this.plugin.clearGlossaryPaletteHistory();
                new Notice("「最近使った」履歴をクリアしました。");
              }
            ).open();
          })
      );
  }

}
