// ─────────────────────────────────────────
// Novels Note JP — 設定タブ
// ─────────────────────────────────────────

import { App, PluginSettingTab, Setting } from "obsidian";
import NovelsNoteJP from "../main";

export class NovelsNoteSettingTab extends PluginSettingTab {
  plugin: NovelsNoteJP;

  constructor(app: App, plugin: NovelsNoteJP) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    this.renderEditorSection(containerEl);
    this.renderRulerSection(containerEl);
    this.renderRubySection(containerEl);
    this.renderVerticalPreviewSection(containerEl);
    this.renderFullWidthSpaceSection(containerEl);
    this.renderWordCountSection(containerEl);
    this.renderExcludeFoldersSection(containerEl);
    this.renderHighlightSection(containerEl);
    this.renderTagSection(containerEl);
    this.renderBracketSection(containerEl);
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

    new Setting(containerEl)
      .setName("カーソル行のハイライトを有効にする")
      .setDesc("縦書きプレビューでエディタのカーソル行を背景色で強調します。")
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.verticalCursorHighlightEnabled)
          .onChange(async value => {
            this.plugin.settings.verticalCursorHighlightEnabled = value;
            await this.plugin.saveSettings();
            this.plugin.applyEditorStyles();
          })
      );

    new Setting(containerEl)
      .setName("カーソル行の背景色")
      .setDesc("縦書きプレビューでカーソル位置の行に付ける背景色。")
      .addColorPicker(picker =>
        picker.setValue(this.plugin.settings.verticalCursorHighlightColor)
          .onChange(async value => {
            this.plugin.settings.verticalCursorHighlightColor = value;
            await this.plugin.saveSettings();
            this.plugin.applyEditorStyles();
          })
      );
  }

  // ─────────────────────────────────────────
  // 全角スペース可視化セクション
  // ─────────────────────────────────────────
  private renderFullWidthSpaceSection(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("全角スペースの表示").setHeading();
    containerEl.createEl("p", {
      text: "段落先頭の全角スペースを目視で確認できます。本文テキストは変更しません。",
      cls: "setting-item-description",
    });

    new Setting(containerEl)
      .setName("全角スペースを可視化する")
      .setDesc("オンにすると全角スペース（\u3000）の位置を記号で表示します。")
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
      .setName("表示スタイル")
      .setDesc(
        "dot: 中央に薄いドットを重ねる（目立ちにくい）　" +
        "underline: 下線で幅を示す　" +
        "box: 薄い枠線で囲む"
      )
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
      .setDesc("可視化マーカーの色（エディタのテーマに合わせて調整してください）。")
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
      .setDesc("Vault ルートからの相対パスを入力してください（例：_templates、characters/_templates）。")
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
              this.display();
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
      const row = containerEl.createEl("div", {
        cls: "setting-item nn-exclude-folder-row",
      });
      row.addClass("nn-exclude-folder-item-row");

      // フォルダアイコン＋パス
      const label = row.createEl("span", { cls: "setting-item-name nn-folder-label" });
      const icon = label.createEl("span", { cls: "nn-folder-icon", text: "📁" });
      label.createEl("code", { text: folders[i] });

      // 削除ボタン
      const delBtn = row.createEl("button", { text: "削除", cls: "mod-warning nn-folder-del-btn" });
      delBtn.addEventListener("click", () => {
        this.plugin.settings.excludeFolders.splice(i, 1);
        void this.plugin.saveSettings().then(() => {
          void this.plugin.buildTermIndex();
          this.plugin.updateSidebar();
          this.plugin.refreshEditors();
          this.display();
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
    this.display(); // セクション全体を再描画
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
            this.display();
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
      const rowEl = containerEl.createEl("div", { cls: "novels-note-tag-row nn-drag-row" });
      rowEl.setAttribute("draggable", "true");
      rowEl.dataset.idx = String(i);

      // ── ドラッグハンドル ────────────────────────────
      const handle = rowEl.createEl("span", { cls: "nn-drag-handle", title: "ドラッグして並べ替え" });
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
            this.display();
          })
      );
      setting.addExtraButton(btn =>
        btn.setIcon("arrow-down").setTooltip("下へ移動")
          .onClick(async () => {
            if (capturedI === defs.length - 1) return;
            [defs[capturedI], defs[capturedI + 1]] = [defs[capturedI + 1], defs[capturedI]];
            await saveAndRefresh();
            this.display();
          })
      );
      setting.addExtraButton(btn =>
        btn.setIcon("trash").setTooltip("このカテゴリを削除")
          .onClick(async () => {
            defs.splice(capturedI, 1);
            await saveAndRefresh();
            this.display();
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

        void saveAndRefresh().then(() => this.display());
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
            this.display();
          })
      );
  }

  private renderBracketList(containerEl: HTMLElement): void {
    const defs = this.plugin.settings.bracketDefinitions;
    for (let i = 0; i < defs.length; i++) {
      const bd = defs[i];
      const setting = new Setting(containerEl);
      setting.settingEl.addClass("novels-note-bracket-row");
      setting.addText(text =>
        text.setPlaceholder("表示名").setValue(bd.label)
          .onChange(async value => {
            defs[i].label = value;
            await this.plugin.saveSettings();
          })
      );
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
            this.display();
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
      .setDesc([
        "なろう式：漢字《ルビ》 または |漢字《ルビ》（半角縦棒）",
        "青空文庫式：漢字《ルビ》 または ｜漢字《ルビ》（全角縦棒）",
        "でんでん式：{漢字|ルビ}",
        "HTMLタグ：<ruby>漢字<rt>ルビ</rt></ruby>",
      ].join("　/　"))
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
      .setDesc(
        "raw: 文字数そのまま　" +
        "novel: 全角1字・半角0.5字で換算　" +
        "manuscript: 400字詰め原稿用紙の枚数"
      )
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
      .setDesc(
        "オンにすると段落先頭などの全角スペース（　）も1文字としてカウントします。" +
        "オフ（デフォルト）にすると除外します。"
      )
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
      .setDesc(
        "オンにすると内容のない行（空行）の改行文字もカウント対象にします。" +
        "通常はオフ（デフォルト）のままで構いません。"
      )
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
      .setDesc(
        "オンにすると原稿中に書いた #tag（キャラクター登録などの目印）も文字数としてカウントします。" +
        "オフ（デフォルト）にすると #tag を除外します（エクスポート時の除去と同じ扱いになります）。"
      )
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.countHashtags)
          .onChange(async value => {
            this.plugin.settings.countHashtags = value;
            await this.plugin.saveSettings();
            this.plugin.updateWordCount();
          })
      );
  }

}
