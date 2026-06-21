// ─────────────────────────────────────────
// Novels Note JP — メインプラグイン
// ─────────────────────────────────────────

import { Plugin, WorkspaceLeaf, TFile, MarkdownView, Notice } from "obsidian";
import { EditorView } from "@codemirror/view";

import {
  NovelsNoteSettings,
  DEFAULT_SETTINGS,
  DEFAULT_TAG_DEFINITIONS,
  DEFAULT_BRACKET_DEFINITIONS,
} from "./settings";
import { SIDEBAR_VIEW_TYPE, VERTICAL_VIEW_TYPE, NOVEL_READING_VIEW_TYPE, TermEntry, settingsEffect, novelModeEffect, novelModeField } from "./types";
import {
  buildBracketExtension,
  buildTermExtension,
  buildRulerExtension,
  buildFullWidthSpaceExtension,
  buildTermDropExtension,
  buildRubyExtension,
} from "./editor/extensions";
import { NovelsNoteSidebarView } from "./views/sidebarView";
import { NovelsNoteSettingTab } from "./core/settingTab";
import { countCharacters, formatCount, CountMode } from "./core/wordCount";
import { ExportModal } from "./export/exportModal";
import { VerticalPreviewView } from "./views/verticalPreview";
import { NovelReadingView } from "./views/novelReadingView";
import { onEditorMenuForRuby } from "./editor/rubyInserter";

export default class NovelsNoteJP extends Plugin {
  private terms: TermEntry[] = [];
  settings: NovelsNoteSettings = DEFAULT_SETTINGS;
  private statusBarEl: HTMLElement | null = null;
  private rebuildTimer: ReturnType<typeof setTimeout> | null = null;
  private adoptedSheet: CSSStyleSheet | null = null;

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
        return view;
      }
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
    this.addSettingTab(new NovelsNoteSettingTab(this.app, this));
    this.registerExportCommand();
    this.registerVerticalPreviewCommand();
    this.registerNovelReadingViewCommand();

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
      buildRubyExtension(() => this.settings)
    );

    // ─────────────────────────────────────────
    // 右クリック「ルビを振る」メニュー
    // ─────────────────────────────────────────
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor, info) => {
        if (!(info instanceof MarkdownView)) return;
        onEditorMenuForRuby(this.app, () => this.settings, menu, editor, info);
      })
    );

    this.applyEditorStyles();

    this.app.workspace.onLayoutReady(async () => {
      await this.buildTermIndex();
      this.updateSidebar();
      this.refreshEditors();
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
      void this.buildTermIndex().then(() => {
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
    // 新しいリーフの novelMode 状態を更新する
    // ─────────────────────────────────────────
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        this.refreshEditors();
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
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved) as NovelsNoteSettings;
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
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
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
      }`
      : "";

    // ルーラー
    const rulerCss = `
      .cm-editor[data-novel-mode="true"] .novel-ruler-line { position: relative; }
      .cm-editor[data-novel-mode="true"] .novel-ruler-line::after {
        content: ""; position: absolute;
        top: 0; left: ${wrapWidth};
        transform: translateX(-1px);
        width: 0; height: 100%;
        border-left: 1px ${s.rulerStyle} ${s.rulerColor};
        opacity: ${s.rulerOpacity}; pointer-events: none;
      }`;

    // カーソルハイライト
    const cursorHighlightCss = s.verticalCursorHighlightEnabled
      ? `.nn-vertical-text .nn-sent.nn-cursor {
          background: ${s.verticalCursorHighlightColor} !important;
          opacity: 0.85; border-radius: 2px; }`
      : `.nn-vertical-text .nn-sent.nn-cursor { background: none; }`;

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
      ${cursorHighlightCss}
    `;

    // CSSStyleSheet API で注入（style 要素不使用）
    if (!this.adoptedSheet) {
      this.adoptedSheet = new CSSStyleSheet();
      activeDocument.adoptedStyleSheets = [...activeDocument.adoptedStyleSheets, this.adoptedSheet];
    }
    this.adoptedSheet.replaceSync(css);
  }


  // ─────────────────────────────────────────
  // 用語インデックス構築
  // ─────────────────────────────────────────
  async buildTermIndex(): Promise<void> {
    this.terms = [];
    const validTags = new Set(this.settings.tagDefinitions.map(td => td.tag));
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

      let tags: string[] = [];
      if (Array.isArray(fm.tags)) {
        tags = fm.tags.map((t: unknown) => String(t).replace(/^#/, ""));
      } else if (typeof fm.tags === "string") {
        tags = [fm.tags.replace(/^#/, "")];
      }

      const matchedTag = tags.find(t => validTags.has(t));
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

      this.terms.push({ name, aliases, tag: matchedTag, filePath: file.path });
    }

    this.terms.sort((a, b) => b.name.length - a.name.length);
    console.log(`Novels Note JP: ${this.terms.length} 件の用語を読み込みました。`);
  }

  // ─────────────────────────────────────────
  // 指定ファイルが mode:novel かどうかを判定する
  // ─────────────────────────────────────────
  private isNovelModeFile(file: TFile | null): boolean {
    if (!file) return false;
    const cache = this.app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter as Record<string, unknown> | undefined;
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
    
    // クリックでモード切り替え（raw → novel → manuscript → raw ...）
    this.statusBarEl.addEventListener("click", () => {
      const modes: CountMode[] = ["raw", "novel", "manuscript"];
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
    const result = countCharacters(text, this.settings);
    this.statusBarEl.setText(formatCount(result, this.settings.countMode));
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

        new ExportModal(this.app, file, this.settings.rubyStyle).open();
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
    if (existing.length > 0) {
      void workspace.revealLeaf(existing[0]);
      return;
    }
    // 右サイドバーに開く。なければ新しいリーフを作る
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
}
