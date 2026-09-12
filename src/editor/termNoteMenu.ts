// ─────────────────────────────────────────
// Novels Note JP — エディタ本文からの用語ノート新規作成
//
// エディタ上でテキストを選択して右クリック →
// 「用語ノートの新規作成」→「カテゴリ選択」→
// 用語ノートの新規作成モーダルを起動する（選択した文字列と
// カテゴリの情報をモーダルに引き継ぐ）。
//
// Obsidian の公開 Menu API にはネイティブなサブメニュー
// （ホバーで開くフライアウト）が存在しないため、1階層目の
// メニュー項目をクリックした位置に2階層目のメニュー
// （カテゴリ一覧）を新たに表示する、という段階的な構成で
// 「2段階の右クリックメニュー」を実現する。
// ─────────────────────────────────────────

import { App, Editor, MarkdownView, Menu, Notice } from "obsidian";
import { TagDefinition } from "../settings";
import { CreateTermModal, createTermNote } from "../core/termNoteCreator";

// ─────────────────────────────────────────
// editor-menu イベントハンドラ登録
//
// Plugin.registerEvent で呼んでもらうため、
// コールバック関数を返す形にする（onEditorMenuForRuby と同じ形）。
// ─────────────────────────────────────────
export function onEditorMenuForTermNote(
  app: App,
  getTagDefs: () => TagDefinition[],
  menu: Menu,
  editor: Editor,
  _info: MarkdownView
): void {
  const selected = editor.getSelection();

  // 選択がなければメニューに追加しない
  if (!selected || selected.length === 0) return;

  // メニュー先頭に区切り線を入れることで、他プラグインが追加した
  // メニュー項目（例：ローカル履歴など）とこのプラグインの項目が
  // 混同されないようにする。
  // 「用語ノートの新規作成」と「ルビを振る」の間の区切り線は
  // onEditorMenuForRuby（rubyInserter.ts）側の先頭 addSeparator() が
  // 担うため、ここで重ねて追加しない（区切り線の二重表示を防ぐ）。
  menu.addSeparator();
  menu.addItem(item => {
    item
      .setTitle("用語ノートの新規作成")
      .setIcon("file-plus")
      .onClick((evt: MouseEvent | KeyboardEvent) => {
        const tagDefs = getTagDefs().filter(td => td.enabled);
        if (tagDefs.length === 0) {
          new Notice("カテゴリが設定されていません。設定画面でカテゴリを追加してください。");
          return;
        }

        // 2階層目：カテゴリ選択メニュー
        const categoryMenu = new Menu();
        for (const td of tagDefs) {
          categoryMenu.addItem(catItem => {
            catItem
              .setTitle(td.label)
              .onClick(() => {
                // 3階層目：用語ノートの新規作成モーダル
                // （選択した文字列とカテゴリの情報を適用）
                new CreateTermModal(
                  app,
                  "",
                  getTagDefs(),
                  td.tag,
                  async (termName: string, folderPath: string, tag: string) => {
                    await createTermNote(app, termName, folderPath, tag);
                  },
                  selected
                ).open();
              });
          });
        }

        if (evt instanceof MouseEvent) {
          categoryMenu.showAtMouseEvent(evt);
        } else {
          // キーボード操作等でクリック座標が取得できない場合の
          // フォールバック（画面中央付近に表示する）
          categoryMenu.showAtPosition({
            x: window.innerWidth / 2,
            y: window.innerHeight / 2,
          });
        }
      });
  });
}
