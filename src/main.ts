// ─────────────────────────────────────────
// Novels Note JP — メインプラグイン
// ─────────────────────────────────────────

import { Plugin, WorkspaceLeaf, TFile, MarkdownView } from "obsidian";
import { EditorView } from "@codemirror/view";

import {
  NovelsNoteSettings,
  DEFAULT_SETTINGS,
  DEFAULT_TAG_DEFINITIONS,
  DEFAULT_BRACKET_DEFINITIONS,
} from "./settings";
import { SIDEBAR_VIEW_TYPE, VERTICAL_VIEW_TYPE, TermEntry, settingsEffect } from "./types";
import {
  buildBracketExtension,
  buildTermExtension,
  buildRulerExtension,
  buildFullWidthSpaceExtension,
} from "./extensions";
import { NovelsNoteSidebarView } from "./sidebarView";
import { NovelsNoteSettingTab } from "./settingTab";
import { countCharacters, formatCount, CountMode } from "./wordCount";
import { ExportModal } from "./exportModal";
import { VerticalPreviewView } from "./verticalPreview";

export default class NovelsNoteJP extends Plugin {
  private terms: TermEntry[] = [];
  settings: NovelsNoteSettings = DEFAULT_SETTINGS;
  private styleEl: HTMLStyleElement | null = null;
  private statusBarEl: HTMLElement | null = null;

  // ─────────────────────────────────────────
  // ロード
  // ─────────────────────────────────────────
  async onload(): Promise<void> {
    console.log("Novels Note JP: loading...");

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
        return view;
      }
    );

    this.addRibbonIcon("book-open", "Novels Note JP を開く", () =>
      this.activateSidebar()
    );
    this.addRibbonIcon("book", "縦書きプレビューを開く", () =>
      this.activateVerticalPreview()
    );
    this.addSettingTab(new NovelsNoteSettingTab(this.app, this));
    this.registerExportCommand();
    this.registerVerticalPreviewCommand();

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

    this.applyEditorStyles();

    this.app.workspace.onLayoutReady(async () => {
      await this.buildTermIndex();
      this.updateSidebar();
      this.refreshEditors();
    });

    this.registerVaultEvents();
    this.initWordCount();

    console.log("Novels Note JP: loaded.");
  }

  async onunload(): Promise<void> {
    if (this.styleEl) this.styleEl.remove();
    if (this.statusBarEl) this.statusBarEl.remove();
    console.log("Novels Note JP: unloaded.");
  }

  // ─────────────────────────────────────────
  // Vault イベント登録
  // ─────────────────────────────────────────
  private registerVaultEvents(): void {
    this.registerEvent(
      this.app.vault.on("modify", async file => {
        if (file instanceof TFile && file.extension === "md") {
          await this.waitForMetadata(file);
          await this.buildTermIndex();
          this.updateSidebar();
          this.refreshEditors();
        }
      })
    );
    this.registerEvent(
      this.app.vault.on("create", async file => {
        if (file instanceof TFile && file.extension === "md") {
          await this.waitForMetadata(file);
          await this.buildTermIndex();
          this.updateSidebar();
          this.refreshEditors();
        }
      })
    );
    this.registerEvent(
      this.app.vault.on("delete", async () => {
        await this.buildTermIndex();
        this.updateSidebar();
        this.refreshEditors();
      })
    );
    this.registerEvent(
      this.app.vault.on("rename", async file => {
        if (file instanceof TFile && file.extension === "md") {
          await this.waitForMetadata(file);
        }
        await this.buildTermIndex();
        this.updateSidebar();
        this.refreshEditors();
      })
    );
    this.registerEvent(
      this.app.metadataCache.on("changed", async () => {
        await this.buildTermIndex();
        this.updateSidebar();
        this.refreshEditors();
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
            (leaf.view as NovelsNoteSidebarView).setTerms(
              this.terms,
              this.settings.tagDefinitions
            );
          }
        }
      })
    );
  }

  // ─────────────────────────────────────────
  // 設定 ロード／セーブ
  // ─────────────────────────────────────────
  async loadSettings(): Promise<void> {
    const saved = await this.loadData();
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
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  // ─────────────────────────────────────────
  // CSS 動的生成
  // ─────────────────────────────────────────
  applyEditorStyles(): void {
    if (this.styleEl) this.styleEl.remove();

    const s = this.settings;
    const wrapWidth = `${s.wrapColumn}em`;

    // カッコ色
    const bracketColorCss = s.bracketDefinitions
      .map(bd => `.novel-bracket-${bd.id} { color: ${bd.color}; }`)
      .join("\n");

    // 用語色：.cm-content 配下で !important を付けて確実に優先
    const tagColorCss = s.tagDefinitions
      .map(td => `.cm-content .novel-hl-${td.tag} { color: ${td.color} !important; }`)
      .join("\n");

    // サイドバー用（!important なし）
    const tagColorSidebarCss = s.tagDefinitions
      .map(td => `.novels-note-sidebar .novel-hl-${td.tag} { color: ${td.color}; }`)
      .join("\n");

    // ─────────────────────────────────────────
    // 全角スペース可視化 CSS
    //
    // .novel-fwsp        : 共通（position:relative で ::after の基点にする）
    // .novel-fwsp::after : スタイルに応じた可視マーカーを重ねる
    //
    // 【dot】    文字中央に薄い丸ドットを重ねる
    // 【underline】 文字幅いっぱいの下線を引く
    // 【box】    文字を薄い枠で囲む
    // ─────────────────────────────────────────
    const fwColor = s.fullWidthSpaceColor;
    const fwspCss = s.showFullWidthSpace && s.fullWidthSpaceStyle !== "none"
      ? `
      /* 全角スペース共通：疑似要素の基点にするために relative を付与 */
      .cm-content .novel-fwsp {
        position: relative;
        display: inline-block; /* inline 要素に position:relative を効かせる */
      }

      /* dot: 文字の中央にドットを浮かべる */
      .cm-content .novel-fwsp--dot::after {
        content: "·";        /* U+00B7 MIDDLE DOT（半角なので位置調整） */
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        color: ${fwColor};
        opacity: 0.7;
        font-size: 1em;
        pointer-events: none;
        line-height: 1;
      }

      /* underline: 下線で幅を可視化 */
      .cm-content .novel-fwsp--underline {
        border-bottom: 1.5px solid ${fwColor};
        opacity: 0.8;
      }

      /* box: 薄い枠線で囲む */
      .cm-content .novel-fwsp--box {
        outline: 1px solid ${fwColor};
        opacity: 0.6;
      }
      `
      : "";

    // ─────────────────────────────────────────
    // ルーラー（折り返しガイドライン）CSS
    //
    // 【バグ修正】
    // 旧実装では background-color と border-left を両方指定していたため、
    // background-color が前面になり破線が見えなかった。
    //
    // 修正方針：
    //   background-color を廃止し、border-left だけで縦線を描く。
    //   ただし border-left は要素の幅に含まれず left 位置がズレるため、
    //   transform: translateX(-1px) で補正する。
    // ─────────────────────────────────────────
    const rulerCss = `
      .novel-ruler-line { position: relative; }
      .novel-ruler-line::after {
        content: "";
        position: absolute;
        top: 0;
        left: ${wrapWidth};
        transform: translateX(-1px); /* border-left の幅ズレを補正 */
        width: 0;                    /* 塗り幅ゼロ＝border-left だけで描く */
        height: 100%;
        border-left: 1px ${s.rulerStyle} ${s.rulerColor};
        opacity: ${s.rulerOpacity};
        pointer-events: none;
      }
    `;

    // カーソルハイライト色（CSS変数として定義し styles.css から参照）
    const cursorHighlightCss = s.verticalCursorHighlightEnabled
      ? `.nn-vertical-text .nn-sent.nn-cursor {
          background: ${s.verticalCursorHighlightColor} !important;
          opacity: 0.85;
          border-radius: 2px;
        }`
      : `.nn-vertical-text .nn-sent.nn-cursor { background: none; }`;

    const css = `
      /* ── Novels Note JP 動的スタイル ── */

.markdown-source-view.mod-cm6 .cm-content {
  font-family: "BIZ UDゴシック", "Noto Sans Mono CJK JP",
               "源ノ角ゴシック", "Yu Gothic", monospace !important;

  font-size: ${s.fontSize}px !important;
  line-height: ${s.lineHeight} !important;
  max-width: ${wrapWidth} !important;
}

.markdown-source-view.mod-cm6 .cm-line {
  line-height: ${s.lineHeight} !important;
}
  /* ─────────────────────────
     CM6 の hanging indent を無効化
     小説向け：折返し行を左端から開始
  ───────────────────────── */
  .markdown-source-view.mod-cm6 .cm-lineWrapping .cm-line {
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

    this.styleEl = document.createElement("style");
    this.styleEl.textContent = css;
    document.head.appendChild(this.styleEl);
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
  // settingsEffect を dispatch して
  // 全 Extension の update() を確実に発火させる
  // ─────────────────────────────────────────
  refreshEditors(): void {
    this.app.workspace.iterateAllLeaves((leaf: WorkspaceLeaf) => {
      const view = leaf.view;
      if (view instanceof MarkdownView) {
        const cm = (view.editor as any).cm as EditorView;
        if (cm) {
          cm.dispatch({ effects: settingsEffect.of(this.settings) });
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
    this.statusBarEl.style.cursor = "pointer";

    // クリックでモード切り替え（raw → novel → manuscript → raw ...）
    this.statusBarEl.addEventListener("click", async () => {
      const modes: CountMode[] = ["raw", "novel", "manuscript"];
      const current = modes.indexOf(this.settings.countMode as CountMode);
      this.settings.countMode = modes[(current + 1) % modes.length];
      await this.saveSettings();
      this.updateWordCount();
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
    this.statusBarEl.setText(formatCount(result, this.settings.countMode as CountMode));
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
    workspace.revealLeaf(leaf);
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
      setTimeout(() => { this.app.metadataCache.offref(ref); resolve(); }, 2000);
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
        (leaf.view as VerticalPreviewView).forceReload();
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
      checkCallback: (checking: boolean) => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view?.file) return false;
        if (!checking) {
          new ExportModal(this.app, view.file, this.settings.rubyStyle).open();
        }
        return true;
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
      workspace.revealLeaf(existing[0]);
      return;
    }
    // 右サイドバーに開く。なければ新しいリーフを作る
    const leaf = workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: VERTICAL_VIEW_TYPE, active: true });
    workspace.revealLeaf(leaf);
  }
}
