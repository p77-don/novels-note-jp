// ─────────────────────────────────────────
// Novels Note JP — メインプラグイン
// ─────────────────────────────────────────

import { Plugin, WorkspaceLeaf, TFile, MarkdownView, Notice, Platform, Editor } from "obsidian";
import { EditorView } from "@codemirror/view";

import {
  NovelsNoteSettings,
  DEFAULT_SETTINGS,
  DEFAULT_TAG_DEFINITIONS,
  DEFAULT_BRACKET_DEFINITIONS,
  TagDefinition,
} from "./settings";
import {
  SIDEBAR_VIEW_TYPE,
  VERTICAL_VIEW_TYPE,
  NOVEL_READING_VIEW_TYPE,
  WRITING_STATS_VIEW_TYPE,
  TermEntry,
  WritingStatsEntry,
  settingsEffect,
  novelModeEffect,
  novelModeField,
} from "./types";
import {
  buildBracketExtension,
  buildTermExtension,
  buildRulerExtension,
  buildFullWidthSpaceExtension,
  buildEolMarkerExtension,
  buildTermDropExtension,
  buildRubyExtension,
  buildCursorSyncExtension,
  TERM_HOVER_SOURCE_ID,
} from "./editor/extensions";
import { CursorSyncStore } from "./editor/cursorSyncStore";
import { NovelsNoteSidebarView } from "./views/sidebarView";
import { NovelsNoteSettingTab } from "./core/settingTab";
import { countCharacters, countNarrativeAndDialogue, formatCount, CountMode } from "./core/wordCount";
import type { ManuscriptRules } from "./manuscript-rules/types/rules";
import { createDefaultManuscriptRulesDefinition } from "./manuscript-rules/rules/ruleDefaults";
import { readRuleFile, ManuscriptRulesFileError } from "./manuscript-rules/adapter/pluginRuleStore";
import { ExportModal } from "./export/exportModal";
import { VerticalPreviewView } from "./views/verticalPreview";
import { NovelReadingView } from "./views/novelReadingView";
import { WritingStatsView } from "./views/writingStatsView";
import { onEditorMenuForRuby, registerRubyCommands } from "./editor/rubyInserter";
import { TermPreviewModal } from "./core/termPreviewModal";
import { matchTermTag } from "./core/termTree";
import { buildGlossaryPaletteExtension, GlossaryPaletteBundle } from "./editor/glossaryPalette";
import { clearGlossaryHistory } from "./core/glossaryHistory";

// ─────────────────────────────────────────
// HEXカラー → rgba() 文字列変換
//
// ::highlight() 疑似要素は opacity プロパティを解釈しないため、
// 透明度は background-color の alpha チャンネルに焼き込む。
// ─────────────────────────────────────────
function hexToRgba(hex: string, alpha: number): string {
  const body = hex.trim().replace(/^#/, "");
  const full = body.length === 3
    ? body.split("").map(c => c + c).join("")
    : body;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
    // 不正なHEXの場合はそのまま返す（フォールバック）
    return hex;
  }
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ─────────────────────────────────────────
// 用語リストの内容比較
//
// buildTermIndex() は vault 内の「用語ファイル」（frontmatter に
// 有効なタグを持つファイル）を毎回スキャンし直すが、これは
// エディタで原稿を保存するたびにも呼ばれる（vault の modify /
// metadataCache の changed イベントは、原稿ファイル自身の保存でも
// 区別なく発火するため）。
//
// 用語リストの中身が実際には1つも変わっていないのに
// updateSidebar() / refreshEditors() まで実行してしまうと、
// refreshEditors() が全エディタに settingsEffect を即座に
// ディスパッチし、カッコ・用語ハイライトの装飾（Decoration）を
// 強制的に全文書ぶん作り直す。これは無駄な処理であるだけでなく、
// 原稿を書いて保存するたびにエディタのハイライトが明滅する
// （チカチカする）原因になっていた。
//
// そのため、用語リストの内容が実際に変化した場合だけ
// updateSidebar() / refreshEditors() を呼ぶようにする。
// ─────────────────────────────────────────
function areTermListsEqual(a: TermEntry[], b: TermEntry[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x.name !== y.name || x.tag !== y.tag || x.filePath !== y.filePath) return false;
    if (x.aliases.length !== y.aliases.length) return false;
    for (let j = 0; j < x.aliases.length; j++) {
      if (x.aliases[j] !== y.aliases[j]) return false;
    }
  }
  return true;
}

export default class NovelsNoteJP extends Plugin {
  private terms: TermEntry[] = [];
  settings: NovelsNoteSettings = DEFAULT_SETTINGS;
  private statusBarEl: HTMLElement | null = null;
  private rebuildTimer: ReturnType<typeof setTimeout> | null = null;
  private adoptedSheet: CSSStyleSheet | null = null;
  // 「原稿に挿入」用。サイドバー（用語一覧）を開くと、モバイルでは
  // エディタがフォーカス・カーソルを失い app.workspace.activeEditor が
  // 使えなくなるため、直近でアクティブだった原稿ノートのリーフを
  // 別途保持しておく。
  private lastActiveMarkdownLeaf: WorkspaceLeaf | null = null;
  /**
   * カーソル位置・選択範囲の「確定した」変化を、エディタ拡張
   * （buildCursorSyncExtension）から縦書きプレビュー（VerticalPreviewView）
   * へ橋渡しするための共有ストア。詳細は editor/cursorSyncStore.ts を参照。
   */
  private cursorSyncStore = new CursorSyncStore();

  // 設定画面から「最近使った」履歴クリア時に、既に開いている全エディタの
  // メモリ上キャッシュへも反映するために保持する（詳細は
  // clearGlossaryPaletteHistory() を参照）。
  private glossaryPaletteBundle: GlossaryPaletteBundle | null = null;

  // ─────────────────────────────────────────
  // 原稿クリーニング定義（manuscript-rules）のキャッシュ
  //
  // 文字数カウントはエディタの編集のたびに同期的に呼ばれるため、
  // 定義ファイルをその都度読み直すことはできない。そのため、
  // settings.defaultManuscriptRulesFileName が指す定義（未設定時は
  // 組み込みのデフォルト定義）をここにキャッシュしておき、
  // countCharacters() 等はこのキャッシュを同期的に参照する。
  //
  // 定義ファイルはプラグイン専用フォルダ
  // （.obsidian/plugins/novels-note-jp/rules/）に保存する
  // （Novels Bookcrafter 開発計画の凍結に伴う設計変更）。
  //
  // キャッシュは onload 時、および定義ファイルの選択・内容が
  // 変わったとき（settingTab.ts から呼ばれる）に更新する。
  // ─────────────────────────────────────────
  activeManuscriptRules: ManuscriptRules = createDefaultManuscriptRulesDefinition().rules;

  /** プラグイン専用フォルダのパス（Vaultルートからの相対パス）。 */
  get pluginDir(): string {
    return this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
  }

  /** アクティブな原稿クリーニング定義のキャッシュを再読み込みする。 */
  async refreshActiveManuscriptRules(): Promise<void> {
    const fileName = this.settings.defaultManuscriptRulesFileName;
    if (!fileName) {
      this.activeManuscriptRules = createDefaultManuscriptRulesDefinition().rules;
      this.updateWordCount();
      return;
    }
    try {
      const def = await readRuleFile(this.app, this.pluginDir, fileName);
      this.activeManuscriptRules = def.rules;
    } catch (e) {
      const message = e instanceof ManuscriptRulesFileError ? e.message : String(e);
      new Notice(`原稿クリーニング定義を読み込めませんでした（組み込みの初期設定を使用します）：${message}`);
      this.activeManuscriptRules = createDefaultManuscriptRulesDefinition().rules;
    }
    this.updateWordCount();
  }

  // ─────────────────────────────────────────
  // ロード
  // ─────────────────────────────────────────
  async onload(): Promise<void> {
    await this.loadSettings();
    this.registerExtensions(["txt"], "markdown");

    this.registerView(
      SIDEBAR_VIEW_TYPE,
      leaf => {
        const view = new NovelsNoteSidebarView(leaf);
        // onOpen() が自力でデータ取得できるようプラグイン参照を渡す
        view.setPlugin(this);
        return view;
      }
    );
    // 縦書きプレビュー View 登録
    this.registerView(
      VERTICAL_VIEW_TYPE,
      leaf => {
        const view = new VerticalPreviewView(leaf);
        view.setRubyStyleGetter(() => this.settings.rubyStyle);
        view.setFontSizeGetter(()  => this.settings.fontSize);
        view.setWrapColumnGetter(() => this.settings.wrapColumn);
        view.setCursorSyncStore(this.cursorSyncStore);
        view.setLastActiveMarkdownProvider(() => this.getLastActiveMarkdownEditor());
        return view;
      }
    );
    // 小説閲覧 View 登録
    this.registerView(
      NOVEL_READING_VIEW_TYPE,
      leaf => {
        const view = new NovelReadingView(leaf);
        view.setRubyStyleGetter(()  => this.settings.rubyStyle);
        view.setWrapColumnGetter(() => this.settings.wrapColumn);
        view.setFontSizeGetter(()   => this.settings.fontSize);
        view.setSettingsGetter(()   => this.settings);
        view.setPluginDirGetter(()  => this.pluginDir);
        return view;
      }
    );

    // 執筆情報一覧 View 登録
    this.registerView(
      WRITING_STATS_VIEW_TYPE,
      leaf => new WritingStatsView(
        leaf,
        () => this.buildWritingStats(),
        () => this.settings.readingSpeedCharsPerMinute
      )
    );

    this.addRibbonIcon("list-tree", "用語インデックスを開く", () =>
      this.activateSidebar()
    );
    this.addRibbonIcon("square-kanban", "縦書きプレビューを開く", () =>
      this.activateVerticalPreview()
    );
    this.addRibbonIcon("square-chart-gantt", "小説用ビューで表示", () =>
      this.activateNovelReadingView()
    );
    this.addRibbonIcon("bar-chart-3", "執筆情報一覧を開く", () =>
      this.activateWritingStatsView()
    );
    this.addSettingTab(new NovelsNoteSettingTab(this.app, this));
    this.registerExportCommand();
    this.registerVerticalPreviewCommand();
    this.registerNovelReadingViewCommand();
    this.registerWritingStatsCommand();
    this.registerTermLookupCommand();

    // ─────────────────────────────────────────
    // 用語ハイライトのホバープレビュー（hover-link）を
    // Page Preview（コアプラグイン）に登録する。
    // これを行わないと、未登録の source からの hover-link は
    // 既定で「Modキー（Ctrl/Cmd）押下時のみプレビュー表示」扱いに
    // なり、通常のホバーだけでは何も表示されない。
    // defaultMod: false により、Modキー不要の通常ホバーで
    // プレビューが開くようにする（ユーザーは
    // 「設定 → ページプレビュー」で個別に上書き可能）。
    // ─────────────────────────────────────────
    this.registerHoverLinkSource(TERM_HOVER_SOURCE_ID, {
      display: "Novels Note JP（用語ハイライト）",
      defaultMod: false,
    });

    // ─────────────────────────────────────────
    // novelModeField を全エディタに登録
    // mode:novel かどうかを CM6 State として保持する
    // ─────────────────────────────────────────
    this.registerEditorExtension(novelModeField);

    // ─────────────────────────────────────────
    // 折り返し：CSS の white-space ではなく
    // CM6 公式の lineWrapping で制御する
    // ─────────────────────────────────────────
    this.registerEditorExtension(EditorView.lineWrapping);

    // ─────────────────────────────────────────
    // Decoration 優先順位
    // 用語 ＞ カッコ ＞ 全角スペース（ルーラーは行レベル）
    // ─────────────────────────────────────────
    this.registerEditorExtension(
      buildBracketExtension(() => this.settings)
    );
    this.registerEditorExtension(
      buildTermExtension(
        this.app,
        () => this.terms,
        () => this.settings
      )
    );
    this.registerEditorExtension(
      buildRulerExtension(() => this.settings)
    );
    this.registerEditorExtension(
      buildFullWidthSpaceExtension(() => this.settings)
    );
    this.registerEditorExtension(
      buildEolMarkerExtension(() => this.settings)
    );

    // ─────────────────────────────────────────
    // サイドバーの用語をドロップした位置に Wikilink を挿入する
    // novel モードに関係なく、すべてのエディタで動作する
    // ─────────────────────────────────────────
    this.registerEditorExtension(
      buildTermDropExtension(this.app)
    );

    // ─────────────────────────────────────────
    // ルビ表示 Extension
    // mode:novel のエディタ上でルビ記法をインライン描画する
    // ─────────────────────────────────────────
    this.registerEditorExtension(
      buildRubyExtension(() => this.settings, () => this.terms)
    );

    // ─────────────────────────────────────────
    // カーソル同期 Extension
    // カーソル位置・選択範囲の「確定した」変化（IME変換中は除く）を
    // cursorSyncStore に書き込む。縦書きプレビューはこれを購読する。
    // mode:novel に関係なく、すべてのエディタで動作する
    // （縦書きプレビューはアクティブなファイルに追従するため）。
    // ─────────────────────────────────────────
    this.registerEditorExtension(
      buildCursorSyncExtension(this.cursorSyncStore, this.app)
    );

    // ─────────────────────────────────────────
    // 用語入力パレット：トリガー文字でカーソル位置に用語入力UIを表示する
    // ─────────────────────────────────────────
    const glossaryPaletteBundle = buildGlossaryPaletteExtension({
      app: this.app,
      getTerms: () => this.terms,
      getTagDefinitions: () => this.settings.tagDefinitions,
      getSettings: () => this.settings,
      pluginDir: this.pluginDir,
    });
    this.glossaryPaletteBundle = glossaryPaletteBundle;
    this.registerEditorExtension(glossaryPaletteBundle.extension);

    // トリガー文字を経由せず、コマンドパレット／ホットキー／
    // モバイルツールバーからも起動できるようにする
    // （仕様書「起動方法②：コマンド」に対応）。
    //
    // editorCallback ではなく checkCallback を使う理由：
    // editorCallback は「呼び出せる状況でなければ黙って何もしない」
    // ため、Reading View（プレビュー表示）中など CM6 エディタが
    // 存在しない状況で実行された場合に、原因不明のまま
    // "何も起きない" ように見えてしまう。checkCallback にして
    // 自前でチェックすることで、失敗時に必ず理由を Notice で
    // 表示できるようにする。
    this.addCommand({
      id: "open-glossary-palette",
      name: "用語入力パレットを起動",
      checkCallback: (checking: boolean) => {
        const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!mdView) return false;

        if (checking) return true;

        const cm = (mdView.editor as unknown as { cm: EditorView | undefined }).cm;
        if (!cm) {
          new Notice("編集画面（ソースモード／Live Preview）でお試しください。");
          return true;
        }
        const instance = cm.plugin(glossaryPaletteBundle.viewPlugin);
        if (!instance) {
          new Notice("現在のエディタでは用語入力パレットを利用できません。");
          return true;
        }
        instance.openManually();
        return true;
      },
    });


    // ─────────────────────────────────────────
    // 右クリック「ルビを振る」メニュー（デスクトップ）
    // ─────────────────────────────────────────
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor, info) => {
        if (!(info instanceof MarkdownView)) return;
        onEditorMenuForRuby(this.app, () => this.settings, menu, editor, info);
      })
    );

    // ─────────────────────────────────────────
    // 「ルビを振る」「傍点を振る」コマンド
    // editor-menu に加えてコマンドとしても登録する。
    // モバイルには editor-menu を開く導線がないため必須。
    // ─────────────────────────────────────────
    registerRubyCommands(this, this.app, () => this.settings);

    this.applyEditorStyles();

    this.app.workspace.onLayoutReady(async () => {
      await this.buildTermIndex();
      this.updateSidebar();
      this.refreshEditors();
      // Vaultのファイルインデックスが構築される前に読み込むと、
      // 実在する定義ファイルでも getAbstractFileByPath が見つけられず
      // 誤って「読み込めませんでした」という通知が出てしまうため、
      // onLayoutReady（Vault準備完了後）まで遅延させる。
      await this.refreshActiveManuscriptRules();
    });

    this.registerVaultEvents();
    this.initWordCount();
  }

  onunload(): void {
    // adoptedStyleSheets から自分のシートを除去
    if (this.adoptedSheet) {
      activeDocument.adoptedStyleSheets = activeDocument.adoptedStyleSheets.filter(s => s !== this.adoptedSheet);
      this.adoptedSheet = null;
    }
    if (this.rebuildTimer !== null) {
      window.clearTimeout(this.rebuildTimer);
      this.rebuildTimer = null;
    }
    if (this.statusBarEl) this.statusBarEl.remove();
  }

  // ─────────────────────────────────────────
  // 用語インデックス再構築のデバウンス
  //
  // modify / create / delete / rename / metadataCache.changed は
  // 1回の保存操作でも複数回連続して発火することがあるため、
  // 短時間に連続した呼び出しを1回にまとめてから
  // buildTermIndex() / updateSidebar() / refreshEditors() を実行する。
  // 大規模 Vault（数百〜数千ファイル）での連続再構築によるCPU負荷を防ぐ。
  // ─────────────────────────────────────────
  private scheduleRebuild(delay = 400): void {
    if (this.rebuildTimer !== null) {
      window.clearTimeout(this.rebuildTimer);
    }
    this.rebuildTimer = window.setTimeout(() => {
      this.rebuildTimer = null;
      void this.buildTermIndex().then(changed => {
        // 用語リストの中身が実際に変わった場合だけサイドバー更新・
        // エディタのハイライト再構築を行う（詳細は
        // areTermListsEqual() のコメント参照）。
        if (!changed) return;
        this.updateSidebar();
        this.refreshEditors();
      });
    }, delay);
  }

  // ─────────────────────────────────────────
  // Vault イベント登録
  // ─────────────────────────────────────────
  private registerVaultEvents(): void {
    this.registerEvent(
      this.app.vault.on("modify", async file => {
        if (file instanceof TFile && file.extension === "md") {
          await this.waitForMetadata(file);
          this.scheduleRebuild();
        }
      })
    );
    this.registerEvent(
      this.app.vault.on("create", async file => {
        if (file instanceof TFile && file.extension === "md") {
          await this.waitForMetadata(file);
          this.scheduleRebuild();
        }
      })
    );
    this.registerEvent(
      this.app.vault.on("delete", () => {
        this.scheduleRebuild();
      })
    );
    this.registerEvent(
      this.app.vault.on("rename", async file => {
        if (file instanceof TFile && file.extension === "md") {
          await this.waitForMetadata(file);
        }
        this.scheduleRebuild();
      })
    );
    this.registerEvent(
      this.app.metadataCache.on("changed", () => {
        this.scheduleRebuild();
      })
    );

    // ─────────────────────────────────────────
    // layout-change：右サイドバーの「展開」ボタンなど
    // ビューが可視状態になった瞬間にデータを流し込む
    // ─────────────────────────────────────────
    this.registerEvent(
      this.app.workspace.on("layout-change", () => {
        const leaves = this.app.workspace.getLeavesOfType(SIDEBAR_VIEW_TYPE);
        for (const leaf of leaves) {
          // leaf が実際に画面上に見えているときだけ更新
          if (leaf.view instanceof NovelsNoteSidebarView) {
            leaf.view.setTerms(
              this.terms,
              this.settings.tagDefinitions
            );
          }
        }
      })
    );

    // ─────────────────────────────────────────
    // active-leaf-change：タブ切り替え時に
    // 新しいリーフの novelMode 状態を更新する。
    // あわせて「原稿に挿入」用に最後にアクティブだった
    // 原稿ノートのリーフを記録しておく。
    // ─────────────────────────────────────────
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        this.refreshEditors();
        if (leaf && leaf.view instanceof MarkdownView) {
          this.lastActiveMarkdownLeaf = leaf;
        }
      })
    );

    // ─────────────────────────────────────────
    // file-open：ファイルを開いた直後に
    // cm.dom が確定してから novelMode を付与する
    // ─────────────────────────────────────────
    this.registerEvent(
      this.app.workspace.on("file-open", () => {
        // CM6 が DOM を構築し終えるのを少し待つ
        window.setTimeout(() => this.refreshEditors(), 50);
      })
    );
  }

  // ─────────────────────────────────────────
  // 設定 ロード／セーブ
  // ─────────────────────────────────────────
  async loadSettings(): Promise<void> {
    const saved = await this.loadData() as Partial<NovelsNoteSettings> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
    if (!saved?.tagDefinitions) {
      this.settings.tagDefinitions = DEFAULT_TAG_DEFINITIONS.map(td => ({ ...td }));
    }
    if (!saved?.bracketDefinitions) {
      this.settings.bracketDefinitions = DEFAULT_BRACKET_DEFINITIONS.map(bd => ({ ...bd }));
    }
    // 旧バージョンの保存データには excludeFolders がないため明示的に保証する
    if (!Array.isArray(this.settings.excludeFolders)) {
      this.settings.excludeFolders = [];
    }
    // 旧バージョンの保存データには statsExcludeFolders がないため明示的に保証する
    if (!Array.isArray(this.settings.statsExcludeFolders)) {
      this.settings.statsExcludeFolders = [];
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /**
   * 用語入力パレットの「最近使った」履歴をすべて削除する
   * （設定画面の「クリア」ボタンから呼ばれる）。
   *
   * ディスク上のファイルを削除するだけでなく、既に開いている
   * 全エディタが保持しているメモリ上の履歴キャッシュも同時に
   * リセットする。これが無いと、既に開いているノートでは
   * パレットを開いた瞬間に古いキャッシュがそのまま使われてしまい、
   * ノートを切り替えるまで「クリアされていない」ように見えてしまう。
   */
  async clearGlossaryPaletteHistory(): Promise<void> {
    await clearGlossaryHistory(this.app, this.pluginDir);

    const bundle = this.glossaryPaletteBundle;
    if (!bundle) return;

    this.app.workspace.iterateAllLeaves(leaf => {
      if (!(leaf.view instanceof MarkdownView)) return;
      const cm = (leaf.view.editor as unknown as { cm: EditorView | undefined }).cm;
      cm?.plugin(bundle.viewPlugin)?.resetHistoryCache();
    });
  }

  // ─────────────────────────────────────────
  // CSS 動的生成
  //
  // mode:novel のエディタにのみスタイルを適用するため、
  // セレクタに [data-novel-mode="true"] を付与する。
  // このデータ属性は refreshEditors() でリーフの
  // containerEl に付け外しされる。
  // ─────────────────────────────────────────
  // ─────────────────────────────────────────
  // CSS 動的スタイル適用
  //
  // CSSStyleSheet API（Constructable Stylesheets）を使い、
  // document.adoptedStyleSheets に追加する。
  // <style> 要素を DOM に挿入しない方式のため
  // Obsidian レビューの "Creating style elements is not allowed" に抵触しない。
  // ─────────────────────────────────────────
  applyEditorStyles(): void {
    const s = this.settings;
    const wrapWidth = `${s.wrapColumn}em`;

    // カッコ色（novel-mode 限定）
    const bracketColorCss = s.bracketDefinitions
      .map(bd => `.cm-editor[data-novel-mode="true"] .novel-bracket-${bd.id} { color: ${bd.color}; }`)
      .join("\n");

    // 用語色（novel-mode 限定）
    const tagColorCss = s.tagDefinitions
      .map(td => `.cm-editor[data-novel-mode="true"] .cm-content .novel-hl-${td.tag} { color: ${td.color} !important; }`)
      .join("\n");

    // サイドバー用（!important なし・data-novel-mode 不要）
    const tagColorSidebarCss = s.tagDefinitions
      .map(td => `.novels-note-sidebar .novel-hl-${td.tag} { color: ${td.color}; }`)
      .join("\n");

    // 用語ハイライトのホバープレビューが有効な場合のみ、
    // ホバー可能であることを示すカーソルを付ける
    // （無効時に「ホバーできそうに見えるのに反応しない」状態を避ける）
    const termHoverCursorCss = s.termHoverPreviewEnabled
      ? `.cm-editor[data-novel-mode="true"] .cm-content [class*="novel-hl-"] { cursor: help; }`
      : "";

    // 全角スペース可視化
    const fwColor = s.fullWidthSpaceColor;
    const fwspCss = s.showFullWidthSpace && s.fullWidthSpaceStyle !== "none"
      ? `
      .cm-editor[data-novel-mode="true"] .cm-content .novel-fwsp {
        position: relative;
        display: inline-block;
      }
      .cm-editor[data-novel-mode="true"] .cm-content .novel-fwsp--dot::after {
        content: "·";
        position: absolute;
        top: 50%; left: 50%;
        transform: translate(-50%, -50%);
        color: ${fwColor}; opacity: 0.7;
        font-size: 1em; pointer-events: none; line-height: 1;
      }
      .cm-editor[data-novel-mode="true"] .cm-content .novel-fwsp--underline {
        border-bottom: 1.5px solid ${fwColor}; opacity: 0.8;
      }
      .cm-editor[data-novel-mode="true"] .cm-content .novel-fwsp--box {
        outline: 1px solid ${fwColor}; opacity: 0.6;
      }
      .cm-editor[data-novel-mode="true"] .cm-content .novel-eol {
        position: relative;
        display: inline-block;
        width: 0;
      }
      .cm-editor[data-novel-mode="true"] .cm-content .novel-eol-mark {
        position: absolute;
        top: 50%; left: 0.15em;
        transform: translateY(-50%);
        color: ${fwColor}; opacity: 0.5;
        font-size: 1em; pointer-events: none; line-height: 1;
        user-select: none;
      }`
      : "";

    // ルーラー
    //
    // .cm-content の実際の折り返し幅は
    // `max-width: ${wrapWidth}` によって「wrapWidth と実際に使える
    // 幅のうち小さい方」に決まる（画面が狭ければ wrapWidth より
    // 先に折り返される）。ルーラーの位置も同じ基準（100% = 行の実幅）
    // でクランプしないと、狭い画面では実際の折り返し位置より
    // 右側にガイドラインだけが表示されてズレて見える。
    const rulerCss = `
      .cm-editor[data-novel-mode="true"] .novel-ruler-line { position: relative; }
      .cm-editor[data-novel-mode="true"] .novel-ruler-line::after {
        content: ""; position: absolute;
        top: 0; left: min(${wrapWidth}, 100%);
        transform: translateX(-1px);
        width: 0; height: 100%;
        border-left: 1px ${s.rulerStyle} ${s.rulerColor};
        opacity: ${s.rulerOpacity}; pointer-events: none;
      }`;

    // カーソルハイライト
    //
    // 縦書きプレビューのカーソル位置ハイライトは、以前は
    // <span class="nn-sent nn-cursor"> にクラスを付け外しして
    // 背景色を当てていたが、文単位の <span> 自体を廃止したため
    // CSS Custom Highlight API（::highlight() 疑似要素）に移行した。
    //
    // ::highlight() は background-color / color / font-weight 程度
    // しか解釈できず、opacity や border-radius は効かない
    // （ボックスモデルを持たない疑似要素のため）。
    // 従来の「不透明色 + opacity: 0.85」と同じ見た目にするため、
    // あらかじめ alpha チャンネルを焼き込んだ rgba() に変換して渡す。
    // モバイルでは「エディタと縦書きプレビューを同時に見ながら執筆する」
    // 前提が成立しない（独立タブで同時表示できない）ため、設定値に
    // かかわらず常に無効化する。設定タブ側でもこの設定は disabled 表示
    // だが、保存済みの値自体（他プラットフォームと同期される可能性が
    // ある値）は変更しないため、ここで実際の描画だけを強制的に止める。
    const cursorHighlightCss = s.verticalCursorHighlightEnabled && !Platform.isMobile
      ? `::highlight(nn-cursor) {
          background-color: ${hexToRgba(s.verticalCursorHighlightColor, 0.85)};
        }`
      : `::highlight(nn-cursor) { background-color: transparent; }`;

    const css = `
      .cm-editor[data-novel-mode="true"] .cm-content {
        font-family: var(--nn-font-mono-gothic) !important;
        font-size: ${s.fontSize}px !important;
        line-height: ${s.lineHeight} !important;
        max-width: ${wrapWidth} !important;
      }
      .cm-editor[data-novel-mode="true"] .cm-line {
        line-height: ${s.lineHeight} !important;
      }
      .cm-editor[data-novel-mode="true"] .cm-lineWrapping .cm-line {
        padding-left: 0 !important;
        text-indent: 0 !important;
      }
      ${rulerCss}
      ${fwspCss}
      ${bracketColorCss}
      ${tagColorCss}
      ${tagColorSidebarCss}
      ${termHoverCursorCss}
      ${cursorHighlightCss}
    `;

    // CSSStyleSheet API で注入（style 要素不使用）
    //
    // 【重要】new CSSStyleSheet() は、そのコンストラクタ呼び出しが
    // 実行された「レルム」に紐づいたスタイルシートを作成する。
    // もしこのレルムが activeDocument のレルムと一致しない場合、
    // 「Sharing constructed stylesheets in multiple documents is
    //  not allowed」という例外が発生し、onload() 全体が失敗する
    // （Obsidianの内部実装の変化により、プラグイン読み込み時点の
    //  activeDocument のレルムが、素の CSSStyleSheet コンストラクタの
    //  レルムと一致しなくなるケースが実機で確認された）。
    // activeDocument.defaultView.CSSStyleSheet（そのウィンドウ自身の
    // コンストラクタ）を明示的に使うことで、常に activeDocument と
    // 同じレルムでスタイルシートを構築し、この問題を回避する。
    //
    // 万が一それでも失敗した場合に onload() 全体を巻き込んで
    // プラグインが起動不能になることを防ぐため、try/catch で保護する
    // （この場合エディタの動的CSS適用だけがスキップされる）。
    try {
      if (!this.adoptedSheet) {
        const win = activeDocument.defaultView ?? window;
        this.adoptedSheet = new win.CSSStyleSheet();
        activeDocument.adoptedStyleSheets = [...activeDocument.adoptedStyleSheets, this.adoptedSheet];
      }
      this.adoptedSheet.replaceSync(css);
    } catch (e) {
      console.error("[Novels Note JP] エディタ用CSSの適用でエラーが発生しました。", e);
    }
  }


  // ─────────────────────────────────────────
  // 用語インデックス構築
  // ─────────────────────────────────────────
  /**
   * 用語インデックスを再構築する。
   * 戻り値は「実際に用語リストの内容が変化したかどうか」。
   * 呼び出し元はこれを見て、変化がなければ updateSidebar() /
   * refreshEditors() をスキップできる（詳細は scheduleRebuild() 参照）。
   */
  async buildTermIndex(): Promise<boolean> {
    const previousTerms = this.terms;
    this.terms = [];
    const files = this.app.vault.getMarkdownFiles();

    // 除外フォルダのリストを正規化（末尾スラッシュを統一）
    const excludedPrefixes = (this.settings.excludeFolders ?? [])
      .map(f => f.trim())
      .filter(f => f.length > 0)
      .map(f => f.endsWith("/") ? f : f + "/");

    for (const file of files) {
      // 除外フォルダに含まれるファイルはスキップ
      if (excludedPrefixes.some(prefix => file.path.startsWith(prefix))) continue;

      const cache = this.app.metadataCache.getFileCache(file);
      if (!cache?.frontmatter) continue;
      const fm = cache.frontmatter;

      const matchedTag = matchTermTag(fm, this.settings.tagDefinitions);
      if (!matchedTag) continue;

      const name: string =
        typeof fm.name === "string" && fm.name.trim() !== ""
          ? fm.name.trim() : file.basename;

      let aliases: string[] = [];
      if (Array.isArray(fm.aliases)) {
        aliases = fm.aliases.map((a: unknown) => String(a));
      } else if (typeof fm.aliases === "string") {
        aliases = [fm.aliases];
      }

      // frontmatter の name プロパティを採用した場合、name には
      // file.basename（ファイル名）が入らず、ファイル名がハイライト
      // 対象から漏れてしまう。name とは別に aliases へファイル名を
      // 追加することで、「ファイル名」「name」「aliases」の
      // すべてがハイライトされるようにする
      // （name と同一の場合や、既に aliases に含まれる場合は重複を避ける）。
      if (name !== file.basename && !aliases.includes(file.basename)) {
        aliases.push(file.basename);
      }

      this.terms.push({ name, aliases, tag: matchedTag, filePath: file.path });
    }

    this.terms.sort((a, b) => b.name.length - a.name.length);

    return !areTermListsEqual(previousTerms, this.terms);
  }

  // ─────────────────────────────────────────
  // 指定ファイルが mode:novel かどうかを判定する
  // ─────────────────────────────────────────
  private isNovelModeFile(file: TFile | null): boolean {
    if (!file) return false;
    const cache = this.app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter;
    return fm?.["mode"] === "novel";
  }

  // ─────────────────────────────────────────
  // 全エディタの novelModeField と data-novel-mode 属性を更新する
  //
  // 各 MarkdownView のリーフ containerEl に
  // data-novel-mode="true/false" を付与することで、
  // CSS セレクタ [data-novel-mode="true"] でスコープを絞る。
  // 同時に novelModeEffect を dispatch して Extension に通知する。
  // ─────────────────────────────────────────
  refreshEditors(): void {
    this.app.workspace.iterateAllLeaves((leaf: WorkspaceLeaf) => {
      const view = leaf.view;
      if (view instanceof MarkdownView) {
        const file = view.file ?? null;
        const isNovel = this.isNovelModeFile(file);

        // CM6 State を更新し、EditorView.dom に data-novel-mode 属性を付与
        // cm.dom は .cm-editor 要素であり、CSS セレクタ
        // [data-novel-mode="true"].cm-editor で確実にスコープが効く
        const cm = (view.editor as unknown as { cm: EditorView | undefined }).cm;
        if (cm) {
          cm.dom.dataset.novelMode = isNovel ? "true" : "false";
          cm.dispatch({
            effects: [
              novelModeEffect.of(isNovel),
              settingsEffect.of(this.settings),
            ],
          });
        }
      }
    });
  }

  // ─────────────────────────────────────────
  // 文字数カウント
  // ─────────────────────────────────────────

  /**
   * ステータスバーアイテムを作成し、
   * エディタのアクティブ変更・編集のたびに文字数を更新する。
   * クリックでカウントモードを順番に切り替える。
   */
  initWordCount(): void {
    this.statusBarEl = this.addStatusBarItem();
    this.statusBarEl.addClass("novels-note-wordcount");
    this.statusBarEl.title = "クリックでカウントモードを切り替え";
    this.statusBarEl.setCssProps({ cursor: "pointer" });
    
    // クリックでモード切り替え（raw → novel → page → raw ...）
    this.statusBarEl.addEventListener("click", () => {
      const modes: CountMode[] = ["raw", "novel", "page"];
      const current = modes.indexOf(this.settings.countMode);
      this.settings.countMode = modes[(current + 1) % modes.length];
      void this.saveSettings().then(() => this.updateWordCount());
    });

    // アクティブファイルが変わったとき
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        this.updateWordCount();
      })
    );

    // エディタを編集したとき（タイプするたびに更新）
    this.registerEvent(
      this.app.workspace.on("editor-change", () => {
        this.updateWordCount();
      })
    );

    // 初回表示
    this.updateWordCount();
  }

  /**
   * 現在アクティブなエディタのテキストを取得してカウントし、
   * ステータスバーを更新する。
   * .txt / .md 両対応。エディタが開いていない場合は非表示。
   */
  updateWordCount(): void {
    if (!this.statusBarEl) return;

    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      this.statusBarEl.setText("—");
      return;
    }

    const text = view.editor.getValue();
    const result = countCharacters(text, this.settings, this.activeManuscriptRules);
    this.statusBarEl.setText(formatCount(result, this.settings.countMode, this.settings));
  }

  // ─────────────────────────────────────────
  // サイドバー 開閉・更新
  // ─────────────────────────────────────────
  async activateSidebar(): Promise<void> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = null;
    const existing = workspace.getLeavesOfType(SIDEBAR_VIEW_TYPE);
    if (existing.length > 0) {
      leaf = existing[0];
    } else {
      leaf = workspace.getRightLeaf(false);
      if (!leaf) return;
      await leaf.setViewState({ type: SIDEBAR_VIEW_TYPE, active: true });
    }
    void workspace.revealLeaf(leaf);
    // リーフを表示した直後にデータを流し込む
    this.updateSidebar();
  }

  updateSidebar(): void {
    const leaves = this.app.workspace.getLeavesOfType(SIDEBAR_VIEW_TYPE);
    for (const leaf of leaves) {
      if (leaf.view instanceof NovelsNoteSidebarView) {
        leaf.view.setTerms(this.terms, this.settings.tagDefinitions);
      }
    }
  }

  // ─────────────────────────────────────────
  // ユーティリティ
  // ─────────────────────────────────────────
  waitForMetadata(file: TFile): Promise<void> {
    return new Promise(resolve => {
      const cache = this.app.metadataCache.getFileCache(file);
      if (cache) { resolve(); return; }
      const ref = this.app.metadataCache.on("changed", changedFile => {
        if (changedFile.path === file.path) {
          this.app.metadataCache.offref(ref);
          resolve();
        }
      });
      window.setTimeout(() => { this.app.metadataCache.offref(ref); resolve(); }, 2000);
    });
  }

  getTerms(): TermEntry[] {
    return this.terms;
  }

  getTagDefs(): TagDefinition[] {
    return this.settings.tagDefinitions;
  }

  // ─────────────────────────────────────────
  // 縦書きプレビュー強制再描画
  // ルビ設定変更時に呼ぶ
  // ─────────────────────────────────────────
  refreshVerticalPreview(): void {
    const leaves = this.app.workspace.getLeavesOfType(VERTICAL_VIEW_TYPE);
    for (const leaf of leaves) {
      if (leaf.view instanceof VerticalPreviewView) {
        leaf.view.forceReload();
      }
    }
  }

  // ─────────────────────────────────────────
  // Export コマンド登録
  // ─────────────────────────────────────────
  private registerExportCommand(): void {
    this.addCommand({
      id: "export-current-file",
      name: "現在のファイルを原稿 Export する",
      callback: () => {
        // MarkdownView（編集・リーディングモード）からファイルを取得
        let file: TFile | null = null;

        const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (mdView?.file) {
          file = mdView.file;
        }

        // 小説ビューがアクティブな場合はそこからファイルを取得
        if (!file) {
          const leaf = this.app.workspace.getMostRecentLeaf();
          if (leaf?.view instanceof NovelReadingView) {
            file = leaf.view._file;
          }
        }

        if (!file) {
          new Notice("エクスポート対象のファイルが見つかりません。");
          return;
        }

        new ExportModal(this.app, file, this.settings, this.pluginDir).open();
      },
    });
  }

  // ─────────────────────────────────────────
  // 縦書きプレビュー コマンド・開閉
  // ─────────────────────────────────────────
  private registerVerticalPreviewCommand(): void {
    this.addCommand({
      id: "open-vertical-preview",
      name: "縦書きプレビューを開く",
      callback: () => this.activateVerticalPreview(),
    });
  }

  async activateVerticalPreview(): Promise<void> {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(VERTICAL_VIEW_TYPE);

    // モバイルでは右サイドバーとエディタを同時に表示できず、
    // カーソル同期・自動スクロール追従の意味が失われるため、
    // 小説閲覧ビューと同様にメインエリアの独立タブとして開く。
    //
    // 注意：Obsidianは以前のワークスペースレイアウトを保存・復元する
    // ため、過去に右サイドバーで開かれていたリーフが existing に
    // 残っていることがある。その場合にそのまま revealLeaf すると
    // 右サイドバー表示のままになってしまうため、モバイルでは
    // 既存リーフを一旦すべて閉じてから、必ずタブとして開き直す。
    if (Platform.isMobile) {
      for (const leaf of existing) {
        leaf.detach();
      }
      const leaf = workspace.getLeaf("tab");
      await leaf.setViewState({ type: VERTICAL_VIEW_TYPE, active: true });
      void workspace.revealLeaf(leaf);
      return;
    }

    // デスクトップは従来通り右サイドバー（エディタと並べて確認できる）
    if (existing.length > 0) {
      void workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: VERTICAL_VIEW_TYPE, active: true });
    void workspace.revealLeaf(leaf);
  }

  // ─────────────────────────────────────────
  // 小説閲覧 View 開閉
  // ─────────────────────────────────────────
  private registerNovelReadingViewCommand(): void {
    this.addCommand({
      id: "open-novel-reading-view",
      name: "小説閲覧ビューを開く",
      callback: () => this.activateNovelReadingView(),
    });
  }

  async activateNovelReadingView(): Promise<void> {
    const { workspace } = this.app;

    // ─── 現在アクティブな markdown リーフと file を取得 ───
    const activeLeaf = workspace.getMostRecentLeaf();
    let targetLeaf   = activeLeaf;
    let targetFile: TFile | null = null;

    if (
      activeLeaf &&
      activeLeaf.view.getViewType() === "markdown" &&
      (activeLeaf.view as unknown as { file: unknown }).file instanceof TFile
    ) {
      targetFile = (activeLeaf.view as unknown as { file: TFile }).file;
    }

    // アクティブリーフが markdown でない場合、
    // 開いている全リーフから mode:novel のファイルを探す
    if (!targetFile) {
      workspace.iterateAllLeaves(leaf => {
        if (targetFile) return;
        if (leaf.view.getViewType() !== "markdown") return;
        const f = (leaf.view as unknown as { file: unknown }).file;
        if (!(f instanceof TFile)) return;
        const cache = this.app.metadataCache.getFileCache(f);
        if (cache?.frontmatter?.mode === "novel") {
          targetFile = f;
          targetLeaf = leaf;
        }
      });
    }

    if (!targetFile) {
      // 開いているファイルがない、またはすべて対象外
      new Notice("小説用ビューの対象外です。Frontmatter に mode: novel のプロパティを設定してください。");
      return;
    }

    // mode:novel チェック
    const cache = this.app.metadataCache.getFileCache(targetFile);
    if (cache?.frontmatter?.mode !== "novel") {
      // 対象外ファイル：通知を出し、既存の NovelReadingView があれば revealするだけ
      new Notice("小説用ビューの対象外です。Frontmatter に mode: novel のプロパティを設定してください。");
      const existing = workspace.getLeavesOfType(NOVEL_READING_VIEW_TYPE);
      if (existing.length > 0) {
        void workspace.revealLeaf(existing[0]);
      }
      return;
    }

    // ─── 同じファイルを表示中の NovelReadingView が既にあれば revealのみ ───
    const existing = workspace.getLeavesOfType(NOVEL_READING_VIEW_TYPE);
    for (const leaf of existing) {
      const nrv = leaf.view as unknown as NovelReadingView;
      if (nrv._file === targetFile) {
        void workspace.revealLeaf(leaf);
        return;
      }
    }

    // ─── 対象リーフそのものを NovelReadingView に差し替える ───
    if (!targetLeaf) return;
    const file = targetFile; // TypeScript の narrowing のためコピー
    await targetLeaf.setViewState({
      type: NOVEL_READING_VIEW_TYPE,
      state: { filePath: file.path },
    });

    // View が構築された後に setFile を呼んで確実にファイルをセット
    const view = targetLeaf.view;
    if (view instanceof NovelReadingView) {
      view.setFile(file);
      await view.loadCurrentFile();
    }

    void workspace.revealLeaf(targetLeaf);
  }

  // ─────────────────────────────────────────
  // 小説閲覧 View 強制再描画
  // ルビ設定変更時に呼ぶ
  // ─────────────────────────────────────────
  refreshNovelReadingView(): void {
    const leaves = this.app.workspace.getLeavesOfType(NOVEL_READING_VIEW_TYPE);
    for (const leaf of leaves) {
      if (leaf.view instanceof NovelReadingView) {
        leaf.view.forceReload();
      }
    }
  }

  // ─────────────────────────────────────────
  // 執筆情報一覧 コマンド
  // ─────────────────────────────────────────
  private registerWritingStatsCommand(): void {
    this.addCommand({
      id: "open-writing-stats",
      name: "執筆情報一覧を開く",
      callback: () => this.activateWritingStatsView(),
    });
  }

  async activateWritingStatsView(): Promise<void> {
    const { workspace } = this.app;

    // 既に開いていればそのタブを表示し、最新状態に再読み込みする
    const existing = workspace.getLeavesOfType(WRITING_STATS_VIEW_TYPE);
    if (existing.length > 0) {
      void workspace.revealLeaf(existing[0]);
      const view = existing[0].view;
      if (view instanceof WritingStatsView) {
        void view.reload();
      }
      return;
    }

    // メインエリアに新規タブとして開く
    const leafForStats = workspace.getLeaf("tab");
    await leafForStats.setViewState({ type: WRITING_STATS_VIEW_TYPE, active: true });
    void workspace.revealLeaf(leafForStats);
  }

  // ─────────────────────────────────────────
  // 「原稿に挿入」用：最後にアクティブだった原稿ノートの
  // エディタとファイルを取得する。
  // workspace.activeEditor はフォーカスに依存するため、
  // サイドバーを開いた時点（特にモバイル）で失われることがある。
  // active-leaf-change で記録しておいたリーフを使い、
  // そのリーフがまだ有効（閉じられていない）か確認してから返す。
  // ─────────────────────────────────────────
  getLastActiveMarkdownEditor(): { editor: Editor; file: TFile | null } | null {
    // まずは現在フォーカスのあるエディタを優先する（デスクトップ、
    // またはモバイルでもエディタにフォーカスがあるケース）
    const active = this.app.workspace.activeEditor;
    if (active?.editor) {
      return { editor: active.editor, file: active.file ?? null };
    }

    // フォーカスが外れている場合は、記録しておいた直近のリーフを使う。
    // リーフが既に閉じられている可能性があるため、
    // 現在開いている全リーフに含まれているかを確認してから使う。
    const leaf = this.lastActiveMarkdownLeaf;
    if (!leaf) return null;
    const stillOpen = this.app.workspace
      .getLeavesOfType("markdown")
      .includes(leaf);
    if (!stillOpen) return null;

    const view = leaf.view;
    if (view instanceof MarkdownView) {
      return { editor: view.editor, file: view.file ?? null };
    }
    return null;
  }

  // ─────────────────────────────────────────
  // 「選択した文字列の用語ノートを開く」コマンド
  //
  // ホバープレビューはモバイルでは無効化している（物理マウス前提の
  // 機能のため）。その代替として、選択した文字列が用語名・別名と
  // 完全一致すれば該当ノートを開くコマンドを用意する。
  // モバイルの「ツールバーをカスタマイズ」に登録すれば、
  // 選択→タップで実行できる。
  // ─────────────────────────────────────────
  private registerTermLookupCommand(): void {
    this.addCommand({
      id: "open-term-note-from-selection",
      name: "選択した文字列の用語ノートを開く",
      editorCallback: (editor: Editor) => {
        const selected = editor.getSelection();
        if (!selected || selected.length === 0) {
          new Notice("用語として開きたい文字列を選択してください。");
          return;
        }
        const term = this.terms.find(
          t => t.name === selected || t.aliases.includes(selected)
        );
        if (!term) {
          new Notice(`「${selected}」に一致する用語が見つかりません。`);
          return;
        }
        // ホバープレビューは「見るだけ」で原稿から離れないのに対し、
        // コマンドでいきなりノートを開くと画面遷移してしまい、
        // ホバーの代替としては体験が異なる。まずモーダルで
        // 用語情報を見せ、必要なら明示的に開いてもらう。
        new TermPreviewModal(this.app, term, () => {
          const file = this.app.vault.getAbstractFileByPath(term.filePath);
          if (!(file instanceof TFile)) {
            new Notice("用語ノートの読み込みに失敗しました。");
            return;
          }
          void this.app.workspace.getLeaf(false).openFile(file);
        }).open();
      },
    });
  }

  // ─────────────────────────────────────────
  // 執筆情報一覧 データ構築
  //
  // mode:novel の frontmatter を持つノートを vault 全体から検索し、
  // statsExcludeFolders で指定されたフォルダを除外する。
  // 各ノートの本文を読み込み、執筆文字数・地の文／会話文の文字数・
  // 作成日時・最終更新日時を集計して返す。
  // ─────────────────────────────────────────
  async buildWritingStats(): Promise<WritingStatsEntry[]> {
    const entries: WritingStatsEntry[] = [];
    const files = this.app.vault.getMarkdownFiles();

    // 除外フォルダのリストを正規化（末尾スラッシュを統一）
    const excludedPrefixes = (this.settings.statsExcludeFolders ?? [])
      .map(f => f.trim())
      .filter(f => f.length > 0)
      .map(f => f.endsWith("/") ? f : f + "/");

    for (const file of files) {
      // 除外フォルダに含まれるファイルはスキップ
      if (excludedPrefixes.some(prefix => file.path.startsWith(prefix))) continue;

      const cache = this.app.metadataCache.getFileCache(file);
      if (cache?.frontmatter?.["mode"] !== "novel") continue;

      const source = await this.app.vault.cachedRead(file);
      const { raw: totalChars, novel: novelChars, pageEquivalent } = countCharacters(source, this.settings, this.activeManuscriptRules);
      const { narrativeChars, dialogueChars } = countNarrativeAndDialogue(source, this.settings, this.activeManuscriptRules);

      const slashIdx = file.path.lastIndexOf("/");
      const folderPath = slashIdx === -1 ? "" : file.path.slice(0, slashIdx);

      entries.push({
        filePath: file.path,
        fileName: file.name,
        folderPath,
        createdAt: file.stat.ctime,
        modifiedAt: file.stat.mtime,
        totalChars,
        narrativeChars,
        dialogueChars,
        novelChars,
        pageEquivalent,
      });
    }

    return entries;
  }
}
