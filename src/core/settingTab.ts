// ─────────────────────────────────────────
// Novels Note JP — 設定タブ
// ─────────────────────────────────────────

import {
  App, PluginSettingTab, Setting, Platform, Notice, ConfirmationModal,
  SettingDefinitionItem, SettingGroupItem,
} from "obsidian";
import NovelsNoteJP from "../main";
import {
  GLOSSARY_PALETTE_FORBIDDEN_TRIGGERS,
  NovelsNoteSettings, DEFAULT_SETTINGS,
} from "../settings";

// 宣言的設定APIの control.key に渡すキー名を NovelsNoteSettings の
// プロパティ名に制限し、タイプミスを型エラーとして検出できるようにする。
// NovelsNoteSettings は全プロパティが通常の文字列キーのため、
// keyof の結果は既に string のサブセットであり、
// `& string` は冗長（Obsidianのコミュニティプラグイン審査の
// 静的解析で "string is overridden by ... in this intersection type"
// という警告の対象になっていた）。
type SettingKey = keyof NovelsNoteSettings;

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
// 以前は Obsidian 標準の ConfirmationModal が @since 1.13.0 で
// minAppVersion（1.8.7）と互換性がなかったため、独自に軽量な実装
// （ConfirmDialog クラス）を用意していた。minAppVersion を 1.13.0 に
// 引き上げたことに伴い、標準の ConfirmationModal に置き換える
// （用語入力パレット「最近使った」履歴クリアの確認ダイアログの
// み利用箇所のため、呼び出し側で直接組み立てる）。
// ─────────────────────────────────────────

export class NovelsNoteSettingTab extends PluginSettingTab {
  plugin: NovelsNoteJP;

  constructor(app: App, plugin: NovelsNoteJP) {
    super(app, plugin);
    this.plugin = plugin;
  }

  // ─────────────────────────────────────────
  // 宣言的設定API（@since 1.13.0）の値の読み書き
  //
  // control 系の定義（type: 'toggle' 等）には onChange に相当する
  // プロパティが無く、値の変更は必ずここ（setControlValue）を
  // 経由する一本道になっている。そのため「保存後に
  // applyEditorStyles()・refreshEditors() 等の副作用を呼ぶ」という
  // 従来 onChange 内で行っていた処理は、key 名で分岐する
  // ディスパッチテーブルとしてここにまとめる。
  //
  // デフォルト実装は this.app.vault.getConfig を読むため、
  // プラグイン設定（this.plugin.settings）を読み書きするよう
  // オーバーライドする。
  // ─────────────────────────────────────────
  getControlValue(key: string): unknown {
    return (this.plugin.settings as unknown as Record<string, unknown>)[key];
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    const settings = this.plugin.settings as unknown as Record<string, unknown>;

    // 用語入力パレットのトリガー文字だけは、保存前にトリムする
    // （前後の空白を含んだまま保存されるのを防ぐ。1文字チェック等の
    // 検証自体は control.validate 側で行う）。
    settings[key] = key === "glossaryPaletteTrigger" ? String(value).trim() : value;

    await this.plugin.saveSettings();

    switch (key) {
      case "fontSize":
      case "lineHeight":
        this.plugin.applyEditorStyles();
        break;
      case "wrapColumn":
        this.plugin.applyEditorStyles();
        this.plugin.refreshEditors();
        break;
      case "showRuler":
      case "rulerStyle":
        this.plugin.refreshEditors();
        break;
      case "rulerColor":
      case "rulerOpacity":
        this.plugin.applyEditorStyles();
        break;
      case "verticalCursorHighlightEnabled":
      case "verticalCursorHighlightColor":
        this.plugin.applyEditorStyles();
        break;
      case "showFullWidthSpace":
      case "fullWidthSpaceStyle":
      case "fullWidthSpaceColor":
        this.plugin.applyEditorStyles();
        this.plugin.refreshEditors();
        break;
      case "highlightEnabled":
        this.plugin.applyEditorStyles();
        this.plugin.refreshEditors();
        break;
      case "termHoverPreviewEnabled":
        this.plugin.applyEditorStyles();
        break;
      case "rubyStyle":
        // 縦書きプレビューを開いていれば即時反映
        this.plugin.refreshVerticalPreview();
        break;
      case "countMode":
      case "countFullWidthSpace":
      case "countEmptyLines":
      case "countHashtags":
        this.plugin.updateWordCount();
        break;
      case "glossaryPaletteEnabled":
      case "glossaryPaletteScope":
      case "glossaryPaletteTrigger":
        this.plugin.refreshEditors();
        break;
      // readingSpeedCharsPerMinute・excludeFolders・statsExcludeFolders・
      // tagDefinitions・bracketDefinitions は保存のみ、または
      // 各動的リストの render コールバック側で個別に副作用を扱う。
      default:
        break;
    }
  }

  // ─────────────────────────────────────────
  // 設定タブ本体（宣言的定義）
  //
  // getSettingDefinitions() を実装したことで display() は完全に
  // 撤去済み（Obsidian側の仕様上、この配列が空でない限り display() は
  // 一切呼ばれなくなるため、以前は動的リスト系セクションを
  // render コールバックで暫定的に包んでいたが、全セクションを
  // 正式な宣言的表現へ移行済み。minAppVersion: 1.13.0）。
  // ─────────────────────────────────────────
  getSettingDefinitions(): SettingDefinitionItem<SettingKey>[] {
    return [
      this.buildEditorSection(),
      this.buildRulerSection(),
      this.buildRubySection(),
      this.buildVerticalPreviewSection(),
      this.buildFullWidthSpaceSection(),
      this.buildWordCountSection(),
      this.buildExcludeFoldersGroup(),
      this.buildStatsExcludeFoldersGroup(),
      this.buildReadingSpeedSection(),
      this.buildHighlightSection(),
      this.buildTagGroup(),
      this.buildBracketGroup(),
      this.buildGlossaryPaletteSection(),
    ];
  }

  // ─────────────────────────────────────────
  // エディタ表示セクション
  // ─────────────────────────────────────────
  private buildEditorSection(): SettingDefinitionItem<SettingKey> {
    return {
      type: "group",
      heading: "エディタ表示",
      items: [
        {
          name: "フォントサイズ（px）",
          desc: "小説本文エディタのフォントサイズ。",
          control: { type: "number", key: "fontSize", min: 1, step: 1, defaultValue: DEFAULT_SETTINGS.fontSize },
        },
        {
          name: "行間",
          desc: "行の高さを倍率で指定します（例：2.0）。",
          control: { type: "number", key: "lineHeight", min: 0.1, step: 0.1, defaultValue: DEFAULT_SETTINGS.lineHeight },
        },
        {
          name: "折り返し文字数",
          desc: "1行に表示する全角文字数（例：40）。",
          control: { type: "number", key: "wrapColumn", min: 1, step: 1, defaultValue: DEFAULT_SETTINGS.wrapColumn },
        },
      ],
    };
  }

  // ─────────────────────────────────────────
  // 折り返しガイドラインセクション
  // ─────────────────────────────────────────
  private buildRulerSection(): SettingDefinitionItem<SettingKey> {
    return {
      type: "group",
      heading: "折り返しガイドライン",
      items: [
        {
          name: "ガイドラインを表示する",
          control: { type: "toggle", key: "showRuler", defaultValue: DEFAULT_SETTINGS.showRuler },
        },
        {
          name: "ガイドライン色",
          control: { type: "color", key: "rulerColor", defaultValue: DEFAULT_SETTINGS.rulerColor },
        },
        {
          name: "ガイドライン透明度",
          desc: "0.0（透明）〜 1.0（不透明）。",
          control: { type: "number", key: "rulerOpacity", min: 0, max: 1, step: 0.05, defaultValue: DEFAULT_SETTINGS.rulerOpacity },
        },
        {
          name: "ガイドラインスタイル",
          control: {
            type: "dropdown", key: "rulerStyle",
            options: { solid: "実線", dashed: "破線" },
            defaultValue: DEFAULT_SETTINGS.rulerStyle,
          },
        },
      ],
    };
  }

  // ─────────────────────────────────────────
  // 縦書きプレビュー設定セクション
  //
  // カーソル行ハイライトは「エディタと縦書きプレビューを同時に見ながら
  // 執筆する」ことが前提の機能。モバイルではエディタと縦書きプレビュー
  // （独立タブ）を同時に表示できず機能自体が意味を持たないため、
  // verticalPreview.ts 側で強制的に無効化している。
  //
  // ここでは項目自体を非表示にはしない。設定を非表示にすると、
  // PC版との見た目の不整合（この設定が存在すること自体が
  // 分からなくなる）が生じるため、項目は表示したまま
  // disabled で無効化し、理由を明記する。
  // ─────────────────────────────────────────
  private buildVerticalPreviewSection(): SettingDefinitionItem<SettingKey> {
    const isMobile = Platform.isMobile;
    return {
      type: "group",
      heading: "縦書きプレビュー",
      items: [
        {
          name: "カーソル行のハイライトを有効にする",
          desc: isMobile
            ? "モバイルでは使用できません。"
            : "縦書きプレビューでエディタのカーソル行を背景色で強調します。",
          control: {
            type: "toggle", key: "verticalCursorHighlightEnabled",
            defaultValue: DEFAULT_SETTINGS.verticalCursorHighlightEnabled,
            disabled: isMobile,
          },
        },
        {
          name: "カーソル行の背景色",
          desc: isMobile
            ? "モバイルでは使用できません。"
            : "縦書きプレビューでカーソル位置の行に付ける背景色。",
          control: {
            type: "color", key: "verticalCursorHighlightColor",
            defaultValue: DEFAULT_SETTINGS.verticalCursorHighlightColor,
            disabled: isMobile,
          },
        },
      ],
    };
  }

  // ─────────────────────────────────────────
  // 全角スペース可視化セクション
  // ─────────────────────────────────────────
  private buildFullWidthSpaceSection(): SettingDefinitionItem<SettingKey> {
    return {
      type: "group",
      heading: "全角スペースと改行記号の表示",
      items: [
        {
          name: "全角スペースを可視化する",
          desc: descLines(
            "段落先頭の全角スペースと、行末の改行位置を目視で確認できます。",
            "オンにすると全角スペース（\u3000）の位置を記号で表示します。",
            "あわせて行末に改行記号（↵）も表示します（オフにすると両方とも非表示になります）。",
            "※改行記号は幅を持たないため、折り返し位置には影響しません。"
          ),
          control: { type: "toggle", key: "showFullWidthSpace", defaultValue: DEFAULT_SETTINGS.showFullWidthSpace },
        },
        {
          name: "全角スペースの表示スタイル",
          desc: descLines(
            "全角スペースの表示方法を選べます（改行記号の見た目には影響しません）。",
            "・ドット： 中央に薄いドットを重ねる",
            "・下線：アンダーラインで幅を示す",
            "・枠線： 薄い線で枠を囲む"
          ),
          control: {
            type: "dropdown", key: "fullWidthSpaceStyle",
            options: { dot: "ドット（中央の点）", underline: "下線", box: "枠線" },
            // "none"（旧・機能オフ用の値）は現在UIから選べないため、
            // 万一そのまま残っていた場合は表示上 "dot" にフォールバックする。
            defaultValue: DEFAULT_SETTINGS.fullWidthSpaceStyle === "none"
              ? "dot"
              : DEFAULT_SETTINGS.fullWidthSpaceStyle,
          },
        },
        {
          name: "表示色",
          desc: "全角スペースの記号・改行記号の色（エディタのテーマに合わせて調整してください）。",
          control: { type: "color", key: "fullWidthSpaceColor", defaultValue: DEFAULT_SETTINGS.fullWidthSpaceColor },
        },
      ],
    };
  }

  // ─────────────────────────────────────────
  // フォルダパス追加モーダル（用語インデックス／執筆情報一覧の
  // 除外フォルダで共用する）
  //
  // SettingDefinitionList の addItem は「＋」ボタン（または
  // モバイルでの「＋ 追加」行）のクリックハンドラを渡せるのみで、
  // テキスト入力欄そのものは提供されない。そのため、クリック時に
  // 標準の ConfirmationModal 上へ Setting + addText で入力欄を
  // 組み立てて表示する。
  // ─────────────────────────────────────────
  private promptForFolderPath(title: string, onSubmit: (value: string) => void): void {
    let value = "";
    const modal = new ConfirmationModal(this.app);
    modal.setTitle(title);
    modal.setContent(createFragment(frag => {
      const el = frag.createDiv();
      new Setting(el)
        .setName("フォルダパス")
        .setDesc(descLines(
          "Vault ルートからの相対パスを入力してください。",
          "（例：templates、characters/templates）"
        ))
        .addText(text => {
          text.setPlaceholder("フォルダパスを入力…");
          text.onChange(v => { value = v; });
          window.setTimeout(() => text.inputEl.focus());
          // Enter キーでも追加できる
          text.inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
            if (e.key === "Enter") {
              e.preventDefault();
              modal.close();
              onSubmit(value);
            }
          });
        });
    }));
    modal.addButton(b => b.setButtonText("キャンセル").setCancel());
    modal.addButton(b =>
      b.setButtonText("追加").setCta()
        .onClick(() => {
          // onSubmit は非同期（保存＋再集計）だが、ConfirmationModal の
          // ボタンは「ハンドラが truthy を返すとモーダルを閉じない」
          // 仕様のため、Promise をそのまま返さないよう void で切り離す。
          void onSubmit(value);
        })
    );
    modal.open();
  }

  // ─────────────────────────────────────────
  // 用語インデックス除外フォルダ セクション
  //
  // Obsidian のグラフビューと同じ方式：
  // フォルダパスのプレフィックス一致で除外する。
  // 例）"_templates" を指定すると
  //     "_templates/character.md" が除外される。
  //
  // Round 2：SettingDefinitionList（onDelete・addItem）へ正式移行。
  // 削除ボタン・並べ替えUIは自前実装をやめ、フレームワークの
  // 標準アフォーダンスに委ねる（このリストは並べ替え不要のため
  // onReorder は指定しない）。
  // ─────────────────────────────────────────
  private async addExcludeFolder(value: string): Promise<void> {
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
    this.update(); // セクション全体を再描画
  }

  private buildExcludeFoldersGroup(): SettingDefinitionItem<SettingKey> {
    const folders = this.plugin.settings.excludeFolders ?? [];
    return {
      type: "list",
      heading: "用語インデックス — 除外フォルダ",
      // SettingDefinitionList には group の desc に相当するフィールドが
      // 無いため、常時表示の説明文は持たせられない。最もガイダンスが
      // 必要な「まだ1件も無い」タイミングに表示されるよう、
      // emptyState に説明文を持たせる。
      emptyState: createFragment(el => {
        el.createEl("p", {
          text:
            "指定したフォルダ内のファイルを用語インデックスから除外します。" +
            "テンプレートフォルダなどを指定してください。" +
            "フォルダパスは Vault ルートからの相対パスで入力します（例：_templates）。",
        });
      }),
      items: folders.map((folder): SettingGroupItem<SettingKey> => ({
        name: folder,
        searchable: false,
        render: (setting) => {
          setting.setName(createFragment(el => {
            el.createSpan({ cls: "nn-folder-icon", text: "📁" });
            el.createEl("code", { text: folder });
          }));
        },
      })),
      onDelete: (index) => {
        void (async () => {
          this.plugin.settings.excludeFolders.splice(index, 1);
          await this.plugin.saveSettings();
          await this.plugin.buildTermIndex();
          this.plugin.updateSidebar();
          this.plugin.refreshEditors();
          this.update();
        })();
      },
      addItem: {
        name: "フォルダを追加",
        action: () => {
          this.promptForFolderPath(
            "除外フォルダを追加（用語インデックス）",
            // addExcludeFolder は async だが、promptForFolderPath の
            // onSubmit は void を期待するシグネチャのため、Promise を
            // そのまま返さないよう void で明示的に切り離す
            // （no-misused-promises 対策）。
            (value) => { void this.addExcludeFolder(value); }
          );
        },
      },
    };
  }

  // ─────────────────────────────────────────
  // 執筆情報一覧 — 推定読了時間の読了速度設定
  // ─────────────────────────────────────────
  private buildReadingSpeedSection(): SettingDefinitionItem<SettingKey> {
    return {
      type: "group",
      heading: "執筆情報一覧 — 推定読了時間",
      items: [
        {
          name: "読了速度（字/分）",
          desc:
            "「執筆情報一覧」に表示する推定読了時間の計算に使う読書速度の目安です。" +
            "小説換算文字数（全角1・半角0.5換算）を基準に計算します。" +
            "あくまで目安のため、実際の読了時間とは差が生じます。" +
            "変更後は「執筆情報一覧」タブの「再集計」（または開き直し）で反映されます。",
          control: {
            type: "number", key: "readingSpeedCharsPerMinute",
            min: 1, step: 10,
            defaultValue: DEFAULT_SETTINGS.readingSpeedCharsPerMinute,
          },
        },
      ],
    };
  }

  // ─────────────────────────────────────────
  // 執筆情報一覧 — 除外フォルダ設定
  //
  // Round 2：buildExcludeFoldersGroup() と同じ方針で
  // SettingDefinitionList へ正式移行。
  // ─────────────────────────────────────────
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
    this.update(); // セクション全体を再描画
  }

  private buildStatsExcludeFoldersGroup(): SettingDefinitionItem<SettingKey> {
    const folders = this.plugin.settings.statsExcludeFolders ?? [];
    return {
      type: "list",
      heading: "執筆情報一覧 — 除外フォルダ",
      emptyState: createFragment(el => {
        el.createEl("p", {
          text:
            "指定したフォルダ内のファイルを「執筆情報一覧」の集計対象から除外します。" +
            "テンプレートフォルダなどを指定してください。" +
            "フォルダパスは Vault ルートからの相対パスで入力します（例：_templates）。" +
            "用語インデックスの除外フォルダとは別に管理されます。",
        });
      }),
      items: folders.map((folder): SettingGroupItem<SettingKey> => ({
        name: folder,
        searchable: false,
        render: (setting) => {
          setting.setName(createFragment(el => {
            el.createSpan({ cls: "nn-folder-icon", text: "📁" });
            el.createEl("code", { text: folder });
          }));
        },
      })),
      onDelete: (index) => {
        void (async () => {
          this.plugin.settings.statsExcludeFolders.splice(index, 1);
          await this.plugin.saveSettings();
          this.update();
        })();
      },
      addItem: {
        name: "フォルダを追加",
        action: () => {
          this.promptForFolderPath(
            "除外フォルダを追加（執筆情報一覧）",
            // addStatsExcludeFolder も同様に async のため、Promise を
            // そのまま返さないよう void で切り離す。
            (value) => { void this.addStatsExcludeFolder(value); }
          );
        },
      },
    };
  }

  // ─────────────────────────────────────────
  // ハイライト全体のオン/オフセクション
  // ─────────────────────────────────────────
  private buildHighlightSection(): SettingDefinitionItem<SettingKey> {
    return {
      type: "group",
      heading: "ハイライト",
      items: [
        {
          name: "ハイライトを有効にする",
          desc: "オフにするとすべてのハイライトが無効になります。",
          control: { type: "toggle", key: "highlightEnabled", defaultValue: DEFAULT_SETTINGS.highlightEnabled },
        },
        {
          name: "用語ハイライトのホバープレビュー",
          desc: descLines(
            "エディタ上でハイライトされた用語にマウスを合わせると、対応する用語ノートを" +
            "Obsidian標準のページプレビュー（Hover Preview）で表示します。",
            "※WikiLinkを書く必要はありません。"
          ),
          control: { type: "toggle", key: "termHoverPreviewEnabled", defaultValue: DEFAULT_SETTINGS.termHoverPreviewEnabled },
        },
      ],
    };
  }

  // ─────────────────────────────────────────
  // カテゴリ定義セクション
  //
  // Round 3：SettingDefinitionList（onReorder・onDelete）へ正式移行。
  // onReorder を指定すると各行にドラッグハンドルが自動で付き、
  // ドラッグ&ドロップによる並べ替えが有効になるため、自前の
  // HTML5 Drag & Drop実装（dragstart/dragover/drop等）は不要になり
  // 削除した。精密な移動がしやすいよう、上下移動ボタンは
  // ドラッグと併用できる形でそのまま残している。
  // ─────────────────────────────────────────
  private buildTagGroup(): SettingDefinitionItem<SettingKey> {
    const defs = this.plugin.settings.tagDefinitions;

    const saveAndRefresh = async () => {
      await this.plugin.saveSettings();
      this.plugin.applyEditorStyles();
      await this.plugin.buildTermIndex();
      this.plugin.updateSidebar();
      this.plugin.refreshEditors();
    };

    return {
      type: "list",
      heading: "カテゴリ定義",
      emptyState: createFragment(el => {
        el.createEl("p", { text: "用語ノートに付けるカテゴリ名・表示名・色・オン/オフを設定します。" });
      }),
      items: defs.map((td, i): SettingGroupItem<SettingKey> => ({
        // 行の「名前」表示は使わず、カテゴリ名自体を編集可能な
        // テキスト欄として render 側で組み立てるため、検索対象からは外す。
        name: td.tag || "（無題のカテゴリ）",
        searchable: false,
        render: (setting) => {
          setting.settingEl.addClass("nn-tag-setting-row");
          // name ラベルは使わないため空にしておく
          // （カテゴリ名自体は addText の1つ目として編集する）。
          setting.setName("");

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
          // 「カラー・トグル・上下移動」を2行目にまとめて
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

          // ── 上下移動ボタン（ドラッグ&ドロップと併用可能） ──────
          setting.addExtraButton(btn =>
            btn.setIcon("arrow-up").setTooltip("上へ移動")
              .onClick(async () => {
                if (capturedI === 0) return;
                [defs[capturedI - 1], defs[capturedI]] = [defs[capturedI], defs[capturedI - 1]];
                await saveAndRefresh();
                this.update();
              })
          );
          setting.addExtraButton(btn =>
            btn.setIcon("arrow-down").setTooltip("下へ移動")
              .onClick(async () => {
                if (capturedI === defs.length - 1) return;
                [defs[capturedI], defs[capturedI + 1]] = [defs[capturedI + 1], defs[capturedI]];
                await saveAndRefresh();
                this.update();
              })
          );
        },
      })),
      onReorder: (oldIndex, newIndex) => {
        const [removed] = defs.splice(oldIndex, 1);
        defs.splice(newIndex, 0, removed);
        void saveAndRefresh().then(() => this.update());
      },
      onDelete: (index) => {
        defs.splice(index, 1);
        void saveAndRefresh().then(() => this.update());
      },
      addItem: {
        name: "カテゴリを追加",
        action: () => {
          defs.push({ tag: "new-tag", label: "新しいカテゴリ", color: "#aaaaaa", enabled: true });
          void this.plugin.saveSettings().then(() => {
            this.plugin.applyEditorStyles();
            this.update();
          });
        },
      },
    };
  }

  // ─────────────────────────────────────────
  // カッコハイライトセクション
  //
  // Round 3：buildTagGroup() と同じ方針で SettingDefinitionList へ
  // 正式移行。並べ替え機能は元々無かったため onReorder は指定しない。
  // ─────────────────────────────────────────
  private buildBracketGroup(): SettingDefinitionItem<SettingKey> {
    const defs = this.plugin.settings.bracketDefinitions;

    return {
      type: "list",
      heading: "カッコハイライト",
      emptyState: createFragment(el => {
        el.createEl("p", { text: "内側のカッコが外側より優先されます。用語の強調表示はすべてのカッコより優先されます。" });
      }),
      items: defs.map((bd, i): SettingGroupItem<SettingKey> => ({
        name: bd.label || "（無題のカッコ）",
        searchable: false,
        render: (setting) => {
          setting.settingEl.addClass("novels-note-bracket-row");
          setting.setName("");

          const capturedI = i; // クロージャ用

          setting.addText(text => {
            text.inputEl.addClass("nn-bracket-label-input");
            text.setPlaceholder("表示名").setValue(bd.label)
              .onChange(async value => {
                defs[capturedI].label = value;
                await this.plugin.saveSettings();
              });
          });
          setting.addText(text => {
            text.inputEl.addClass("nn-bracket-char-input");
            text.setPlaceholder("開").setValue(bd.open)
              .onChange(async value => {
                defs[capturedI].open = value;
                await this.plugin.saveSettings();
                this.plugin.refreshEditors();
              });
          });
          setting.addText(text => {
            text.inputEl.addClass("nn-bracket-char-input");
            text.setPlaceholder("閉").setValue(bd.close)
              .onChange(async value => {
                defs[capturedI].close = value;
                await this.plugin.saveSettings();
                this.plugin.refreshEditors();
              });
          });

          // カテゴリ定義行と同様、狭い画面では「表示名・開始カッコ・
          // 終了カッコ」を1行目、「カラー・トグル」を2行目に
          // まとめて折り返したいので、強制改行用のスペーサーを挟む。
          setting.controlEl.createDiv({ cls: "nn-row-break" });

          setting.addColorPicker(picker =>
            picker.setValue(bd.color)
              .onChange(async value => {
                defs[capturedI].color = value;
                await this.plugin.saveSettings();
                this.plugin.applyEditorStyles();
                this.plugin.refreshEditors();
              })
          );
          setting.addToggle(toggle =>
            toggle.setTooltip("ハイライトのオン/オフ").setValue(bd.enabled)
              .onChange(async value => {
                defs[capturedI].enabled = value;
                await this.plugin.saveSettings();
                this.plugin.refreshEditors();
              })
          );
        },
      })),
      onDelete: (index) => {
        defs.splice(index, 1);
        void this.plugin.saveSettings().then(() => {
          this.plugin.applyEditorStyles();
          this.plugin.refreshEditors();
          this.update();
        });
      },
      addItem: {
        name: "カッコを追加",
        action: () => {
          const newId = `bracket-${Date.now()}`;
          defs.push({
            id: newId, label: "新しいカッコ",
            open: "〔", close: "〕", color: "#aaaaaa", enabled: false,
          });
          void this.plugin.saveSettings().then(() => {
            this.plugin.applyEditorStyles();
            this.update();
          });
        },
      },
    };
  }

  // ─────────────────────────────────────────
  // ルビ設定セクション
  // ─────────────────────────────────────────
  private buildRubySection(): SettingDefinitionItem<SettingKey> {
    return {
      type: "group",
      heading: "ルビ設定",
      items: [
        {
          name: "ルビの記法",
          desc: descLines(
            "縦書きプレビューおよびExportで使用するルビの記法を選択してください。",
            "・なろう式：漢字《ルビ》 または |漢字《ルビ》（半角縦棒）",
            "・青空文庫式：漢字《ルビ》 または ｜漢字《ルビ》（全角縦棒）",
            "・でんでん式：{漢字|ルビ}",
            "・HTMLタグ：<ruby>漢字<rt>ルビ</rt></ruby>"
          ),
          control: {
            type: "dropdown", key: "rubyStyle",
            options: {
              narou: "なろう式（漢字《ルビ》 / |漢字《ルビ》）",
              aozora: "青空文庫式（漢字《ルビ》 / ｜漢字《ルビ》）",
              denden: "でんでん式（{漢字|ルビ}）",
              html: "HTMLタグ（<ruby>）",
            },
            defaultValue: DEFAULT_SETTINGS.rubyStyle,
          },
        },
      ],
    };
  }

  // ─────────────────────────────────────────
  // 文字数カウントセクション
  // ─────────────────────────────────────────
  private buildWordCountSection(): SettingDefinitionItem<SettingKey> {
    return {
      type: "group",
      heading: "文字数カウント",
      items: [
        {
          name: "カウントモード",
          desc: descLines(
            "ステータスバー（画面下部）に原稿の文字数を表示します。クリックでモードを切り替えられます。",
            "raw: 文字数そのまま",
            "novel: 全角1字・半角0.5字で換算",
            "manuscript: 400字詰め原稿用紙の枚数"
          ),
          control: {
            type: "dropdown", key: "countMode",
            options: { raw: "raw（文字数）", novel: "novel（小説換算）", manuscript: "manuscript（原稿用紙換算）" },
            defaultValue: DEFAULT_SETTINGS.countMode,
          },
        },
        {
          name: "全角スペースを文字数に含める",
          desc: descLines(
            "オンにすると段落先頭などの全角スペース（　）も1文字としてカウントします。",
            "オフ（デフォルト）にすると除外します。"
          ),
          control: { type: "toggle", key: "countFullWidthSpace", defaultValue: DEFAULT_SETTINGS.countFullWidthSpace },
        },
        {
          name: "空行を文字数に含める",
          desc: descLines(
            "オンにすると内容のない行（空行）の改行文字もカウント対象にします。",
            "通常はオフ（デフォルト）のままで構いません。"
          ),
          control: { type: "toggle", key: "countEmptyLines", defaultValue: DEFAULT_SETTINGS.countEmptyLines },
        },
        {
          name: "#tag を文字数に含める",
          desc: descLines(
            "オンにすると原稿中に書いた #tag（キャラクター登録などの目印）も文字数としてカウントします。",
            "オフ（デフォルト）にすると #tag を除外します（エクスポート時の除去と同じ扱いになります）。"
          ),
          control: { type: "toggle", key: "countHashtags", defaultValue: DEFAULT_SETTINGS.countHashtags },
        },
      ],
    };
  }

  // ─────────────────────────────────────────
  // 用語入力パレットセクション
  // ─────────────────────────────────────────
  private buildGlossaryPaletteSection(): SettingDefinitionItem<SettingKey> {
    return {
      type: "group",
      heading: "用語入力パレット",
      items: [
        {
          name: "用語入力パレットを有効にする",
          desc: "執筆中にトリガー文字を入力すると、用語インデックスから用語を検索・入力できるパレットを開きます。",
          control: { type: "toggle", key: "glossaryPaletteEnabled", defaultValue: DEFAULT_SETTINGS.glossaryPaletteEnabled },
        },
        {
          name: "起動範囲",
          desc: descLines(
            "・原稿ノートのみ：mode: novel が設定されたノートでのみ起動します。",
            "・原稿ノート＋用語ノート（デフォルト）：原稿ノートに加えて、用語ノート（キャラクター・場所などのタグを持つノート）でも起動します。",
            "・すべてのノート：全てのMarkdownノートで起動します。メモ等で普段からトリガー文字を書く場合は誤爆しやすいのでご注意ください。"
          ),
          control: {
            type: "dropdown", key: "glossaryPaletteScope",
            options: { novelOnly: "原稿ノートのみ", novelAndGlossary: "原稿ノート＋用語ノート", all: "すべてのノート" },
            defaultValue: DEFAULT_SETTINGS.glossaryPaletteScope,
          },
        },
        {
          name: "起動トリガー文字",
          desc: descLines(
            "パレットを開くための1文字を指定してください（例： / @ $ : ;）。",
            `Markdownで一般的に使われる ${GLOSSARY_PALETTE_FORBIDDEN_TRIGGERS.join(" ")} は指定できません。`
          ),
          control: {
            type: "text", key: "glossaryPaletteTrigger",
            placeholder: "/",
            defaultValue: DEFAULT_SETTINGS.glossaryPaletteTrigger,
            // 空文字・2文字以上・使用禁止記号は保存前に拒否する
            // （拒否時は元の値のまま維持され、入力欄にはインラインで
            // エラーメッセージが表示される）。
            validate: (value: string) => {
              const trimmed = value.trim();
              if (trimmed.length !== 1) {
                return "トリガー文字は1文字で指定してください。";
              }
              if (GLOSSARY_PALETTE_FORBIDDEN_TRIGGERS.includes(trimmed)) {
                return `「${trimmed}」はMarkdown記法と衝突するため使用できません。`;
              }
              return;
            },
          },
        },
        {
          name: "「最近使った」履歴をクリア",
          desc: "用語入力パレットの「最近使った」に表示される履歴をすべて削除します。この操作は取り消せません。",
          // SettingDefinitionAction は行全体がクリック可能になるだけで
          // ボタン文言（「クリア」）や setDestructive() のスタイルを
          // 指定できないため、従来通り addButton() を使った render で
          // 表現する。
          render: (setting) => {
            setting
              .addButton(btn =>
                btn.setButtonText("クリア")
                  .setDestructive()
                  .onClick(() => {
                    // 標準の ConfirmationModal（@since 1.13.0）を使用する。
                    // 誤操作防止のため、キャンセル側に初期フォーカスを
                    // 当てる（破壊的な「クリア」側をデフォルトフォーカス
                    // にしない）。
                    new ConfirmationModal(this.app)
                      .setTitle("「最近使った」履歴のクリア")
                      .setContent("「最近使った」履歴をすべて削除します。よろしいですか？")
                      .addButton(b => b.setButtonText("キャンセル").setCancel().setInitialFocus())
                      .addButton(b =>
                        b.setButtonText("クリア")
                          .setDestructive()
                          .onClick(async () => {
                            await this.plugin.clearGlossaryPaletteHistory();
                            new Notice("「最近使った」履歴をクリアしました。");
                          })
                      )
                      .open();
                  })
              );
          },
        },
      ],
    };
  }
}
