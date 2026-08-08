// ─────────────────────────────────────────
// Novels Note JP — 用語入力パレット（モバイル用 Modal）
//
// モバイルでは、カーソル位置に追従する自作フローティングポップアップ
// ではなく、Obsidian標準の Modal クラスを使う。
//
// 理由：カスタムの position:fixed 要素は、Obsidianモバイルアプリ
// （Capacitorベース）のソフトウェアキーボードの表示・回避と
// うまく連携できないことが実機検証で判明した
// （visualViewport / innerHeight のどちらもキーボードの高さを
//  正しく反映しなかった）。一方、既存の「用語ノートを新規作成」
// ダイアログ（CreateTermModal、Obsidian標準Modal）では、入力欄から
// フォーカスが外れるとキーボードが正しく閉じ、モーダル全体が
// 正しく表示されることが実機で確認できている。この標準動作の
// 恩恵をそのまま受けるため、モバイルではカスタム配置をやめて
// Modalに任せる。
//
// 表示位置は画面中央ではなく上部を起点にする（styles.css の
// .nn-glossary-modal-container で align-items を上書きしている）。
// ─────────────────────────────────────────

import { App, Modal } from "obsidian";
import { TermEntry } from "../types";
import { CategoryNode } from "../core/termTree";
import { GlossaryPaletteView, GlossaryPaletteCallbacks } from "./glossaryPaletteView";

export class GlossaryPaletteModal extends Modal {
  private paletteView: GlossaryPaletteView | null = null;

  constructor(
    app: App,
    private categories: CategoryNode[],
    private recentFilePaths: string[],
    private allTerms: TermEntry[],
    private callbacks: GlossaryPaletteCallbacks
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl, modalEl, containerEl } = this;
    contentEl.empty();
    // ソフトウェアキーボードはOSネイティブのUIであり、WebView内の
    // どんなCSS z-indexよりも常に最前面に表示される。そのため、
    // モーダルの表示位置がキーボードの占める領域（画面下部）と
    // 重なっていれば、CSSでどう頑張ってもキーボードに隠れてしまう。
    // 唯一の解決策は、キーボードが占めない領域（画面上部）に
    // モーダル自体を配置することなので、画面上部起点で表示する。
    modalEl.addClass("nn-glossary-modal", "nn-mobile-top-modal");
    containerEl.addClass("nn-mobile-top-modal-container");

    this.paletteView = new GlossaryPaletteView(
      contentEl,
      this.categories,
      this.recentFilePaths,
      this.allTerms,
      {
        // 挿入自体は呼び出し元（editor/glossaryPalette.ts）に任せる。
        // 呼び出し元の commitInsert() が closePalette() 経由で
        // このModalの close() を呼ぶため、ここで自ら close() する
        // 必要はない（二重に閉じようとしても closePalette() 側の
        // ガードで無害化される設計になっている）。
        onInsert: (text, filePath) => this.callbacks.onInsert(text, filePath),
        onClose: () => this.close(),
      },
      true // chromeless: Modal自身が背景・枠線・影を持つため、二重にしない
    );

    // 検索欄への自動フォーカスはしない。
    // これを行うとモーダルを開いた瞬間にソフトウェアキーボードが
    // 開いてしまい、ユーザーがどこにもタップしていないのに
    // キーボードで画面の大半が占有される（かつ、どこにフォーカスが
    // あるのか分かりにくい）という問題があった。デスクトップと違い、
    // モバイルでは行のタップだけで一通りの操作（閲覧・階層移動・
    // 選択）が完結するため、検索したい時だけユーザー自身が
    // 検索欄をタップすればよい。
  }

  onClose(): void {
    this.paletteView?.destroy();
    this.paletteView = null;
    this.contentEl.empty();
    this.callbacks.onClose();
  }
}
