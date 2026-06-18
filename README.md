# Novels Note JP

An Obsidian plugin for Japanese fiction writers. It provides a writing environment optimized for Japanese novel composition, with `.txt` file support, vertical writing preview, term highlighting, and manuscript export.

---

## Features

### Novel Mode
Activate novel mode by adding `mode: novel` to a note's frontmatter. All plugin behaviors—fonts, formatting, highlighting—are scoped exclusively to novel-mode notes. Standard notes are unaffected.

```yaml
---
mode: novel
---
```

![editor](docs/editor.png)

### Japanese Writing Environment
- **Optimized monospace font** (BIZ UDGothic, Noto Sans Mono CJK JP, etc.) with adjustable **font size** and **line height**
- **Full-width space (　) visualization** to catch accidental spacing errors
- **Automatic paragraph indentation**
- **Configurable line-wrap column** with a visual ruler/guideline
- **`.txt` file support** — open and edit plain text files directly in Obsidian

### Term Highlighting
Notes tagged with a category (`character`, `location`, `glossary`, `organization`, `item`) register their filename as a term, which is then highlighted wherever it appears in novel-mode editors. Colors and on/off toggles are configurable per category. Additional names for the same term can be registered via `aliases`.

```yaml
---
tags: character
aliases: (register alternative names here)
---
```

### Bracket Highlighting
Highlight Japanese brackets (`「」『』（）【】〈〉《》`) with individually configurable colors and toggles.

### Term Index (Sidebar Panel)
A right-sidebar panel displays all defined terms, organized in a folder-tree view. Features include:
- Expandable folder hierarchy
- Search/filter box with a clear button
- Click-to-open any term note
- Drag-and-drop to move terms between folders
- Drag-and-drop a term into the main pane to insert it as a WikiLink
- Tags collapsed by default on startup
- Configurable exclude-folders list

### Word Count
Three counting modes available:
- **Raw** — total character count
- **Novel-weighted** — counts only manuscript text
- **Manuscript pages** — calculates standard Japanese manuscript page equivalents (400 characters/page)

### Vertical Writing Preview
Preview the current note in vertical writing (`tate-gumi`) layout. Features:
- Cursor position synchronization between the editor and preview
- Selection highlighting preserved through ruby notation
- Export button in the toolbar

![verticalPreview](docs/verticalPreview.png)

### Novel Reading View
A clean reading view that strips WikiLinks, tags, and non-manuscript content. Displays a notice for non-novel-mode files. Includes an export button alongside the standard edit button.

![novelReadingView](docs/novelReadingView.png)

### Export
Export the current note as clean manuscript text via a dedicated export dialog:
- Strips Markdown and Obsidian syntax (WikiLinks, tags, frontmatter, etc.)
- Choose the output format (`.txt` / `.md`) and how ruby notation is handled (keep as-is, convert to another style, or remove)
- Always available via the command palette
- Original files are never modified

![export-document](docs/export-document.png)

---

## Installation

### From Community Plugins
**This will not be distributed via the community plugin.**

### Manual Installation
1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/p77-don/novels-note-jp/releases)
2. Copy the files to your vault's plugin folder: `<vault>/.obsidian/plugins/novels-note-jp/`
3. Reload Obsidian and enable the plugin in **Settings** → **Community plugins**

---

## Usage

### Getting Started

1. Enable the plugin in **Settings** → **Community plugins**
2. Add `mode: novel` to the frontmatter of any note you want to use as a novel manuscript
3. Open **Settings** → **Novels Note JP** to configure font colors, term categories, and other options

### Defining Terms
Create notes for characters, locations, and other story elements, and add the matching category tag to the note's frontmatter `tags`:

| Tag | Category |
|---|---|
| `character` | Character names |
| `location` | Place names |
| `glossary` | Terminology / worldbuilding |
| `organization` | Groups and organizations |
| `item` | Items and objects |

The note's filename (or its `name` frontmatter field, if set) becomes the term, and is automatically highlighted in novel-mode editors.

### Vertical Preview
Use the command palette (`Ctrl/Cmd + P`) and run **縦書きプレビューを開く** (Open Vertical Preview) to open the tate-gumi preview panel.

### Novel Reading View
Run **小説閲覧ビューを開く** (Open Novel Reading View) from the command palette to switch the current note to the clean reading view.

### Export
Run **現在のファイルを原稿 Export する** (Export current file as manuscript) from the command palette to export the current manuscript as clean text.

---

## Settings

| Setting | Description |
|---|---|
| Font size | Font size for novel-mode editors |
| Line height | Line height for novel-mode editors |
| Wrap column | Number of full-width characters per line |
| Show guideline | Enable/disable the line-wrap ruler, with color, opacity, and style options |
| Full-width space visualization | Enable/disable, with display style and color options |
| Highlight: Global toggle | Enable or disable all highlighting |
| Category colors / toggles | Color and enable/disable per term category |
| Bracket colors / toggles | Color and enable/disable per bracket type |
| Ruby notation style | Format used when rendering/exporting ruby notation |
| Word count mode | Raw / Novel-weighted / Manuscript pages |
| Word count options | Whether to include full-width spaces / blank lines in the count |
| Vertical preview cursor highlight | Enable/disable and color for the cursor-line highlight in vertical preview |
| Exclude folders | Folders excluded from the term index |

---

## Requirements

- Obsidian v1.4.0 or later
- Desktop only (uses Node.js file system APIs)

---

## Development

```bash
git clone https://github.com/p77-don/novels-note-jp.git
cd novels-note-jp
npm install
npm run dev
```

Copy `main.js`, `manifest.json`, and `styles.css` to your vault's plugin folder and reload Obsidian.

---

## License

[MIT](LICENSE)

---

## 日本語説明

# Novels Note JP

日本語小説の執筆に特化した Obsidian プラグインです。`.txt` ファイルのサポート、縦書きプレビュー、用語ハイライト、原稿エクスポートなど、小説執筆ワークフローに必要な機能を提供します。

---

## 主な機能

### ノベルモード
フロントマターに `mode: novel` を記載したノートのみにプラグインの機能が適用されます。通常のノートには一切影響を与えません。

```yaml
---
mode: novel
---
```

![editor](docs/editor.png)

### 日本語執筆環境
- **日本語向けに最適化された等幅フォント**（BIZ UDゴシック、Noto Sans Mono CJK JP など）。フォントサイズ・行間は設定で調整可能
- **全角スペースの可視化**（誤入力を防止）
- **段落自動字下げ**
- **折り返し桁数の設定**とビジュアル定規
- **`.txt` ファイル対応** — プレーンテキストファイルを直接編集可能

### 用語ハイライト
カテゴリタグ（`character`、`location`、`glossary`、`organization`、`item`）が付いたノートのファイル名（または `name` プロパティの値）が用語として登録され、エディター上でハイライト表示します。カテゴリごとに色と表示のオン/オフを設定できます。また、`aliases` にて別名を登録することもできます。

```yaml
---
tags: character
aliases: （別名を登録）
---
```

### 括弧ハイライト
日本語括弧（`「」『』（）【】〈〉《》`）を種類ごとに色設定・個別トグルでハイライト表示します。

### 用語インデックス（サイドバーパネル）
右サイドバーに用語の一覧をフォルダツリー形式で表示します。
- フォルダ階層の展開表示
- 検索・フィルタリング（クリアボタン付き）
- クリックでノートを開く
- ドラッグ＆ドロップでフォルダ階層を移動
- ドラッグ＆ドロップでメインペインに用語を挿入（wikilink 形式）
- 起動時はタグを折りたたんだ状態で表示
- 除外フォルダの設定（オプションにて設定）

### 文字数カウント
3つのカウントモードを選択できます：
- **生文字数** — 総文字数
- **小説用重み付き** — 本文のみをカウント
- **原稿用紙換算** — 400字詰め原稿用紙換算枚数

### 縦書きプレビュー
現在のノートを縦書きレイアウトでプレビューします。
- エディターとプレビュー間のカーソル位置同期
- ルビ表記をまたいだ選択範囲のハイライト保持
- ツールバーにエクスポートボタン配置

![verticalPreview](docs/verticalPreview.png)

### 小説閲覧ビュー
WikiLink・タグ・本文以外のコンテンツを除去したクリーンな閲覧ビューです。ノベルモードでないファイルにはポップアップで通知します。

![novelReadingView](docs/novelReadingView.png)

### エクスポート
専用のエクスポートダイアログから、現在のノートをクリーンな原稿テキストとして出力します。
- Markdown・Obsidian記法（WikiLink、タグ、フロントマターなど）を除去
- 出力形式（`.txt` / `.md`）とルビ記法の扱い（保持／他方式へ変換／除去）を選択可能
- コマンドパレットから常に実行可能
- **元のファイルは一切変更されません**

![export-document](docs/export-document.png)

---

## インストール

### コミュニティプラグイン
**コミュニティプラグインからの配布予定はありません。**

### 手動インストール
1. [最新リリース](https://github.com/p77-don/novels-note-jp/releases)から `main.js`、`manifest.json`、`styles.css` をダウンロード
2. Vaultのプラグインフォルダへコピー：`<vault>/.obsidian/plugins/novels-note-jp/`
3. Obsidianを再起動し、**設定** → **コミュニティプラグイン** でプラグインを有効化

---

## 基本的な使い方

1. プラグインを有効化する
2. 原稿として使用したいノートのフロントマターに `mode: novel` を追加する
3. **設定** → **Novels Note JP** でハイライト色・用語カテゴリなどを設定する

### 用語の定義
登場人物・場所・用語などのノートを作成し、対応するカテゴリタグを付与します：

| タグ | カテゴリ |
|---|---|
| `character` | 人物名 |
| `location` | 場所名 |
| `glossary` | 用語・世界観設定 |
| `organization` | 組織・団体 |
| `item` | アイテム・道具 |

ノートのファイル名（または `name` プロパティを設定している場合はその値）が用語として登録され、ノベルモードのエディターで自動的にハイライトされます。

### 縦書きプレビュー
コマンドパレット（`Ctrl/Cmd + P`）から **Novels Note JP: 縦書きプレビューを開く** を実行します。

### 小説閲覧ビュー
コマンドパレットから **Novels Note JP: 小説閲覧ビューを開く** を実行すると、現在のノートを小説閲覧ビューに切り替えます。

### エクスポート
コマンドパレットから **Novels Note JP: 現在のファイルを原稿 Export する** を実行します。

---

## 動作環境

- Obsidian v1.4.0 以降
- デスクトップ版のみ（Node.js API を使用）
