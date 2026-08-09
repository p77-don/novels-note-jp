// ─────────────────────────────────────────
// Novels Note JP — 用語入力パレット CM6拡張
//
// トリガー文字（設定可能、デフォルト "/"）の入力を検知して、
// 用語入力パレットを表示する。
//
// 【設計変更の経緯】
// 当初は「トリガー文字以降にエディタへ直接タイプした文字列を
// 検索クエリとして使う」方式だったが、以下の問題があった：
// - パレット内に入力欄が存在するように見えず分かりにくい
// - CM6のドキュメント変化・選択変化を監視し続ける必要があり、
//   コマンドパレット経由の起動時にフォーカス復元由来の一瞬の
//   選択変化を誤検知して即座に閉じてしまう不具合があった
// - モバイルでソフトウェアキーボードの表示・回避と噛み合わなかった
//
// そのため、パレット自身が通常の <input> 要素を持つ方式に変更した
// （実装は views/glossaryPaletteView.ts 側）。これにより、
// - CM6側は「開く」「（確定時に）テキストを挿入する」だけを担当すればよく、
//   表示中のCM6の変化を監視する必要が一切なくなった
// - デスクトップ／モバイルともに、OS標準のIME・ソフトキーボード連携を
//   そのまま享受できる
//
// UI実装方式：
// - デスクトップ：カーソル位置に追従する自作フローティングポップアップ
// - モバイル：Obsidian標準の Modal クラス（画面上部起点）
//   理由：自作のposition:fixed要素は、Obsidianモバイルアプリ
//   （Capacitorベース）でソフトウェアキーボードの表示・回避と
//   うまく連携できないことが実機検証で判明した。一方、Obsidian標準の
//   Modalは、フォーカスが外れるとキーボードが正しく閉じ、全体が
//   正しく表示されることが確認できたため、Modalに任せる。
//
// buildTermDropExtension / buildCursorSyncExtension と同じ
// findFile パターン（EditorView → TFile の解決）を用いる。
// ─────────────────────────────────────────

import { EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { Extension } from "@codemirror/state";
import { App, MarkdownView, TFile, Notice, Platform } from "obsidian";
import { NovelsNoteSettings, TagDefinition, GlossaryPaletteScope } from "../settings";
import { TermEntry, novelModeField } from "../types";
import { matchTermTag, buildCategoryTree } from "../core/termTree";
import {
  GlossaryHistory,
  loadGlossaryHistory,
  recordGlossaryUsage,
  sortHistoryByRecency,
} from "../core/glossaryHistory";
import { GlossaryPaletteView, GlossaryPaletteCallbacks } from "../views/glossaryPaletteView";
import { GlossaryPaletteModal } from "../views/glossaryPaletteModal";

// デスクトップのフローティングポップアップの想定最大高さ
// （画面下端での反転判定に使用）
const POPUP_ESTIMATED_HEIGHT = 320;

// ─────────────────────────────────────────
// EditorView → TFile 解決
// buildTermDropExtension / buildCursorSyncExtension と同じパターン。
// ─────────────────────────────────────────
function findFileForView(app: App, view: EditorView): TFile | null {
  const ref: { file: TFile | null } = { file: null };
  app.workspace.iterateAllLeaves(leaf => {
    if (ref.file) return;
    if (leaf.view instanceof MarkdownView) {
      const cm = (leaf.view.editor as unknown as { cm: EditorView | undefined }).cm;
      if (cm === view) ref.file = leaf.view.file;
    }
  });
  return ref.file;
}

// ─────────────────────────────────────────
// 起動範囲の判定
// ─────────────────────────────────────────
function isPaletteAllowed(
  scope: GlossaryPaletteScope,
  isNovelMode: boolean,
  file: TFile | null,
  app: App,
  tagDefinitions: TagDefinition[]
): boolean {
  if (scope === "all") return true;
  if (isNovelMode) return true; // 原稿ノートはどの設定でも常に許可
  if (scope === "novelOnly") return false;

  // scope === "novelAndGlossary"
  if (!file) return false;
  const cache = app.metadataCache.getFileCache(file);
  return matchTermTag(cache?.frontmatter, tagDefinitions) !== null;
}

// main.ts（コマンド登録側）から型として参照するための公開インターフェース。
// GlossaryPalettePlugin クラス本体は buildGlossaryPaletteExtension() の
// クロージャ内でしか存在しない（deps を捕捉する必要があるため）が、
// 呼び出し側が必要とするのは openManually() だけなので、
// それだけを切り出したインターフェースを外部公開する。
export interface GlossaryPalettePluginValue {
  openManually(): void;
  /**
   * メモリ上に保持している履歴キャッシュを破棄し、次回開いた時に
   * ディスクから読み直すようにする。設定画面で履歴をクリアした際、
   * 既に開いているエディタ（＝既にキャッシュを読み込み済みの
   * ViewPluginインスタンス）にも即座に反映するために使う
   * （これが無いと、同じノートを開いたままだと「クリアされていない」
   *  ように見えてしまう）。
   */
  resetHistoryCache(): void;
}

export interface GlossaryPaletteDeps {
  app: App;
  getTerms: () => TermEntry[];
  getTagDefinitions: () => TagDefinition[];
  getSettings: () => NovelsNoteSettings;
  /** プラグイン設定フォルダのVault相対パス（manifest.dir） */
  pluginDir: string;
}

export interface GlossaryPaletteBundle {
  extension: Extension;
  viewPlugin: ViewPlugin<GlossaryPalettePluginValue>;
}

export function buildGlossaryPaletteExtension(deps: GlossaryPaletteDeps): GlossaryPaletteBundle {
  class GlossaryPalettePlugin implements GlossaryPalettePluginValue {
    private view: EditorView;
    private isOpen = false;
    private triggerPos = 0;
    // 0: 手動起動（起点に文字は存在しない、純粋な挿入）
    // 1: トリガー文字が実在する（確定時にその1文字を置き換える）
    private triggerCharLength: 0 | 1 = 0;

    // デスクトップ：カーソル追従ポップアップ
    private popupEl: HTMLElement | null = null;
    private paletteView: GlossaryPaletteView | null = null;
    // 一度決めた表示位置（左上の起点）を、内容の行数変化で動かさないためのフラグ。
    private popupPositioned = false;
    // パレット外クリックで閉じるためのリスナー（デスクトップのみ）。
    // 閉じる際に確実に解除する。
    private outsideClickHandler: ((e: MouseEvent) => void) | null = null;
    private outsideClickDoc: Document | null = null;

    // モバイル：Obsidian標準Modal
    private paletteModal: GlossaryPaletteModal | null = null;

    private historyCache: GlossaryHistory = {};
    private historyLoaded = false;

    constructor(view: EditorView) {
      this.view = view;
      // 履歴は起動のたびに読み込む必要はないが、初回パレット表示前に
      // 読み込みを終えておきたいので、エディタ生成時に先読みしておく。
      void this.ensureHistoryLoaded();
    }

    private async ensureHistoryLoaded(): Promise<void> {
      if (this.historyLoaded) return;
      this.historyCache = await loadGlossaryHistory(deps.app, deps.pluginDir);
      this.historyLoaded = true;
    }

    update(update: ViewUpdate): void {
      // パレットが開いている間、検索・階層移動・確定はすべてパレット
      // 自身のUI（検索欄・タップ操作）で完結するため、CM6側の
      // ドキュメント変化や選択変化を監視し続ける必要が一切ない
      // （以前の実装ではここで監視していたため、コマンドパレット経由の
      //  起動直後にフォーカス復元由来の一瞬の選択変化を誤検知して
      //  即座に閉じてしまう不具合があったが、この設計変更により
      //  その種の問題は構造的に起こらなくなった）。
      if (!update.docChanged) return;
      if (this.isOpen) return;

      try {
        this.maybeTrigger(update);
      } catch (e) {
        console.error("[Novels Note JP] 用語入力パレットの起動判定でエラーが発生しました。", e);
      }
    }

    destroy(): void {
      this.closePalette();
    }

    // ─────────────────────────────────────────
    // 手動起動（コマンドパレット／ホットキー／モバイルツールバーから）
    //
    // ─────────────────────────────────────────
    // 手動起動（コマンドパレット／ホットキー／モバイルツールバーから）
    //
    // 起動範囲設定（原稿ノートのみ等）は、トリガー文字での起動と
    // 完全に同じ基準を適用する（以前は「明示的な操作だから常に許可」
    // としていたが、設定と実際の挙動が一致せず分かりにくいという
    // フィードバックを受けて統一した）。
    // ─────────────────────────────────────────
    openManually(): void {
      if (this.isOpen) return;

      const settings = deps.getSettings();
      if (!settings.glossaryPaletteEnabled) {
        new Notice("用語入力パレットは設定で無効になっています。");
        return;
      }

      const sel = this.view.state.selection.main;
      if (!sel.empty) {
        new Notice("テキストを選択した状態では実行できません。カーソルを置いてからお試しください。");
        return;
      }

      const file = findFileForView(deps.app, this.view);
      const isNovel = this.view.state.field(novelModeField, false) ?? false;
      const allowed = isPaletteAllowed(settings.glossaryPaletteScope, isNovel, file, deps.app, deps.getTagDefinitions());
      if (!allowed) {
        new Notice("このノートでは起動範囲の設定により用語入力パレットを利用できません。");
        return;
      }

      this.openPalette(this.view, sel.head, file, 0);
    }

    resetHistoryCache(): void {
      this.historyCache = {};
      // historyLoaded は true のままにする。false に戻すと、次にパレットを
      // 開いた際に ensureHistoryLoaded() が再度ディスクから読み込もうと
      // するが、その読み込みは非同期（openPalette() は同期完結させる
      // 設計のため待たない）なので、開いた瞬間は空の履歴が使われて
      // 実質的には同じ結果になる。ここで {} を直接設定しておけば、
      // 追加の非同期読み込みを待たずに即座に空の状態を反映できる。
    }

    // ─────────────────────────────────────────
    // トリガー検出
    // ─────────────────────────────────────────
    private maybeTrigger(update: ViewUpdate): void {
      const settings = deps.getSettings();
      if (!settings.glossaryPaletteEnabled) return;

      const trigger = settings.glossaryPaletteTrigger;
      if (!trigger) return;

      const sel = update.state.selection.main;
      if (!sel.empty) return;
      const pos = sel.head;
      if (pos === 0) return;

      // 直前の変更で「トリガー文字そのもの」が挿入されたかを確認する。
      // （カーソル移動やIME確定など、他の理由でカーソル直前が
      //   たまたまトリガー文字だったケースを誤検知しないため）
      let triggerInserted = false;
      update.changes.iterChanges((_fromA, _toA, _fromB, toB, inserted) => {
        if (toB === pos && inserted.toString() === trigger) triggerInserted = true;
      });
      if (!triggerInserted) return;

      const file = findFileForView(deps.app, update.view);
      const isNovel = update.view.state.field(novelModeField, false) ?? false;
      const allowed = isPaletteAllowed(settings.glossaryPaletteScope, isNovel, file, deps.app, deps.getTagDefinitions());
      if (!allowed) {
        return;
      }

      this.openPalette(update.view, pos - 1, file, 1);
    }

    // ─────────────────────────────────────────
    // 開閉
    // ─────────────────────────────────────────
    private openPalette(
      view: EditorView,
      triggerPos: number,
      file: TFile | null,
      triggerCharLength: 0 | 1
    ): void {
      void this.ensureHistoryLoaded();
      void file; // 現状は起動範囲判定にのみ使用（将来の拡張用に保持）

      this.isOpen = true;
      this.triggerPos = triggerPos;
      this.triggerCharLength = triggerCharLength;

      const terms = deps.getTerms();
      const categories = buildCategoryTree(terms, deps.getTagDefinitions());
      const recentFilePaths = sortHistoryByRecency(this.historyCache).filter(fp =>
        terms.some(t => t.filePath === fp)
      );

      const callbacks: GlossaryPaletteCallbacks = {
        onInsert: (text, filePath) => this.commitInsert(text, filePath),
        onClose: () => this.closePalette(),
      };

      if (Platform.isMobile) {
        this.paletteModal = new GlossaryPaletteModal(deps.app, categories, recentFilePaths, terms, callbacks);
        this.paletteModal.open();
        return;
      }

      this.popupPositioned = false;
      const doc = view.dom.ownerDocument;
      this.popupEl = doc.body.createDiv({ cls: "nn-glossary-palette-anchor" });
      this.paletteView = new GlossaryPaletteView(this.popupEl, categories, recentFilePaths, terms, callbacks);
      this.reposition();

      // フォーカスの付与はこのタスクの最後まで遅延させる。
      // CM6は「/」キー入力の処理の一環として、この直後に自分自身の
      // contentDOMへフォーカスを戻そうとすることがあり、同期的に
      // ここで検索欄へフォーカスしても、その直後にCM6側の処理で
      // 上書きされてしまう（＝十字キーがエディタのカーソル移動に
      // 使われてしまう）ことが実機で確認された。setTimeoutで次の
      // タスクまで遅らせることで、CM6・ブラウザ側の後処理より後に
      // フォーカスを確定させる（requestAnimationFrameより後のタイミング
      // になるため、より安全な余裕を持たせられる）。
      const win = doc.defaultView ?? window;
      win.setTimeout(() => {
        try {
          if (this.isOpen) this.paletteView?.focusInput();
        } catch (e) {
          console.error("[Novels Note JP] 用語入力パレット：フォーカス処理でエラーが発生しました。", e);
        }
      }, 0);

      // パレット外をクリックしたら閉じる。
      // 以前の実装ではエディタ側の選択変化を監視して自動的に
      // 閉じていたが、その仕組みを撤去した際にこの代替処理を
      // 入れ忘れていた。これが無いと、パレット外をクリックした後も
      // 内部的には isOpen が true のまま残り続け、以降トリガー文字を
      // 入力してもパレットが二度と開かなくなってしまう
      // （update() の先頭で isOpen を見て即座に return するため）。
      //
      // 開いた直後の同一クリック操作（コマンドパレットの選択クリック等）
      // で即座に閉じてしまわないよう、リスナーの登録を次のタスクまで
      // 遅延させる。
      this.outsideClickDoc = doc;
      this.outsideClickHandler = (e: MouseEvent) => {
        try {
          if (this.popupEl && !this.popupEl.contains(e.target as Node)) {
            this.closePalette();
          }
        } catch (err) {
          console.error("[Novels Note JP] 用語入力パレット：外側クリック判定でエラーが発生しました。", err);
        }
      };
      win.setTimeout(() => {
        try {
          if (this.outsideClickHandler) {
            doc.addEventListener("mousedown", this.outsideClickHandler);
          }
        } catch (e) {
          console.error("[Novels Note JP] 用語入力パレット：外側クリックリスナー登録でエラーが発生しました。", e);
        }
      }, 0);
    }

    private closePalette(): void {
      if (!this.isOpen && !this.popupEl && !this.paletteModal) return;
      this.isOpen = false;
      this.popupPositioned = false;

      if (this.outsideClickHandler) {
        this.outsideClickDoc?.removeEventListener("mousedown", this.outsideClickHandler);
        this.outsideClickHandler = null;
        this.outsideClickDoc = null;
      }

      this.paletteView?.destroy();
      this.paletteView = null;
      this.popupEl?.remove();
      this.popupEl = null;

      if (this.paletteModal) {
        const modal = this.paletteModal;
        this.paletteModal = null; // 先にnullにして、Modal.onClose経由の再入を無害化する
        modal.close();
      }

      this.view.focus();
    }

    // ─────────────────────────────────────────
    // 座標計算（デスクトップのフローティングポップアップのみ）
    //
    // 重要：CM6は「update()サイクルの最中に coordsAtPos 等の
    // レイアウト測定を行うこと」を禁止しており、違反すると
    // "Reading the editor layout isn't allowed during an update"
    // という例外を投げる（実機ログで確認済み）。トリガー文字
    // （"/"等）の入力はCM6のupdate()サイクルの中で処理されるため、
    // その中から直接 coordsAtPos を呼ぶことはできない。
    // そのため、CM6が公式に提供している requestMeasure() を使い、
    // 「読み取り（read）」と「書き込み（write）」を正しいフェーズに
    // 分離して実行する。
    //
    // 「左上を起点とする」ため、位置は開いた瞬間に一度だけ決定し、
    // 以降検索結果の増減で行数が変わっても top/left は動かさない
    // （bottom基準で配置すると、内容の高さが変わるたびに上端＝
    //  パンくずの位置が上下してしまい視線が泳ぐため、必ずtop基準で
    //  配置する）。横方向も画面右端で切れないようクランプする。
    // ─────────────────────────────────────────
    private reposition(): void {
      if (!this.popupEl) return;
      if (this.popupPositioned) return;

      this.view.requestMeasure({
        read: (view) => {
          // 読み取りフェーズ：DOMを変更せず、位置計算に必要な値だけを集める
          const coords = view.coordsAtPos(this.triggerPos);
          if (!coords) return null;

          const popupEl = this.popupEl;
          if (!popupEl) return null;

          const win = popupEl.ownerDocument.defaultView;
          const vv = win?.visualViewport;
          const viewportBottom = vv ? vv.offsetTop + vv.height : (win?.innerHeight ?? 800);
          const viewportRight = vv ? vv.offsetLeft + vv.width : (win?.innerWidth ?? 1200);
          const popupWidth = popupEl.getBoundingClientRect().width || 280;

          return { coords, viewportBottom, viewportRight, popupWidth };
        },
        write: (measured) => {
          // 書き込みフェーズ：ここでのみDOMを変更する
          if (!measured || !this.popupEl) return;
          const { coords, viewportBottom, viewportRight, popupWidth } = measured;

          const left = Math.max(4, Math.min(coords.left, viewportRight - popupWidth - 4));

          const spaceBelow = viewportBottom - coords.bottom;
          let top: number;
          if (spaceBelow < POPUP_ESTIMATED_HEIGHT && coords.top > POPUP_ESTIMATED_HEIGHT) {
            // 画面下端に近い場合は、トリガー位置の上端から見積もり高さぶん
            // 上に離れた位置を top として固定する。実際の内容がこれより
            // 低くても top は動かさず、下端側だけが伸縮する
            // （＝左上の起点は常に固定される）。
            top = coords.top - POPUP_ESTIMATED_HEIGHT - 4;
          } else {
            top = coords.bottom + 4;
          }

          // 静的スタイル代入は obsidianmd/no-static-styles-assignment に抵触するため、
          // setCssStyles でまとめて適用する（コミュニティプラグイン審査対応）。
          this.popupEl.setCssStyles({
            position: "fixed",
            right: "",
            bottom: "",
            left: `${left}px`,
            top: `${top}px`,
          });

          this.popupPositioned = true;
        },
      });
    }

    // ─────────────────────────────────────────
    // 入力確定
    // ─────────────────────────────────────────
    private commitInsert(text: string, filePath: string): void {
      // 空状態の行（disabled）などから誤って呼ばれた場合の保険。
      if (!text) return;

      const view = this.view;
      const from = this.triggerPos;
      const to = from + this.triggerCharLength;

      // 必ず「先に閉じてから」挿入する（閉じる処理と挿入処理の
      // 順序が逆だと、閉じかけの状態に対して不要な後処理が
      // 走ってしまう可能性があるため）。
      this.closePalette();

      view.dispatch({
        changes: { from, to, insert: text },
        selection: { anchor: from + text.length },
        userEvent: "input.complete",
      });

      // フォルダ／カテゴリ名を直接入力した場合は対応する用語ファイルが
      // 無いため、履歴には記録しない。
      if (filePath) {
        void recordGlossaryUsage(deps.app, deps.pluginDir, filePath, this.historyCache).then(updated => {
          this.historyCache = updated;
        });
      }
    }
  }

  const glossaryPaletteViewPlugin = ViewPlugin.fromClass(GlossaryPalettePlugin);

  return { extension: [glossaryPaletteViewPlugin], viewPlugin: glossaryPaletteViewPlugin };
}
