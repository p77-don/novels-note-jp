# Novels Note JP

An Obsidian plugin for Japanese fiction writers. It provides a writing environment optimized for Japanese novel composition, with `.txt` file support, vertical writing preview, term highlighting, ruby annotation, and manuscript export.

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
- **Full-width space (　) visualization** to catch accidental spacing errors — choose from dot, underline, box, or none
- **Automatic paragraph indentation**
- **Configurable line-wrap column** with a visual ruler/guideline (color, opacity, and solid/dashed style)
- **`.txt` file support** — open and edit plain text files directly in Obsidian

### Ruby Annotation (Furigana)
Add furigana to selected text from the editor's right-click context menu.

- **ルビを振る** — Select text, right-click, choose "ルビを振る", enter the reading in a popup dialog. A live HTML preview updates as you type, and the annotation is inserted in the configured ruby style.
- **傍点を振る** — Select text, right-click, choose "傍点を振る" to apply emphasis dots (·) to each character instantly.

Four ruby notation styles are supported (configured globally in Settings):

| Style | Format |
|---|---|
| なろう式 | `\|漢字《ルビ》` (half-width pipe) |
| 青空文庫式 | `｜漢字《ルビ》` (full-width pipe) |
| でんでん式 | `{漢字\|ルビ}` |
| HTML | `<ruby>漢字<rt>ルビ</rt></ruby>` |

Ruby notation is also rendered inline in the editor as an HTML `<ruby>` element so you can read the text naturally while writing.

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
- **Right-click on a category or folder** → create a new term note in that location
- **Right-click on a term** → open, rename-by-edit, or delete (moves to system trash with confirmation)
- Drag-and-drop to move terms between folders
- Drag-and-drop a term into the main pane to insert it as a WikiLink
- Tags collapsed by default on startup
- Configurable exclude-folders list

When creating a new term note, you can specify a folder path. If the folder does not exist, a confirmation dialog appears before creating it.

### Word Count
Three counting modes are available, shown in the status bar:

- **Raw** — total character count
- **Novel-weighted** — counts only manuscript text (excluding frontmatter, tags, WikiLinks, etc.)
- **Manuscript pages** — calculates standard Japanese manuscript page equivalents (400 characters/page)

Additional options control whether full-width spaces, blank lines, and hashtags are included in the count.

### Vertical Writing Preview
Preview the current note in vertical writing (`tate-gumi`) layout. Features:

- Cursor position synchronization between the editor and preview
- Selection highlighting preserved through ruby notation
- Configurable cursor-line highlight (color and on/off toggle)
- Export button in the toolbar

![verticalPreview](docs/verticalPreview.png)

### Novel Reading View
A clean reading view that strips WikiLinks, tags, and non-manuscript content. Displays a notice for non-novel-mode files. Includes an export button alongside the standard edit button.

![novelReadingView](docs/novelReadingView.png)

### Export
Export the current note as clean manuscript text via a dedicated export dialog:

- Strips Markdown and Obsidian syntax (WikiLinks, tags, frontmatter, etc.)
- Choose the output format (`.txt` / `.md`)
- Choose how ruby notation is handled: keep as-is, convert to a different style (narou / aozora / denden / HTML), or strip to base text only
- Optionally compress consecutive blank lines into one
- Always available via the command palette
- Original files are never modified

![export-document](docs/export-document.png)

---

## Installation

### From Community Plugins (Recommended)
1. Open **Settings** → **Community plugins** → **Browse**
2. Search for `Novels Note JP`
3. Click **Install**, then **Enable**

### Manual Installation
1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/p77-don/novels-note-jp/releases)
2. Copy the files to your vault's plugin folder: `<vault>/.obsidian/plugins/novels-note-jp/`
3. Reload Obsidian and enable the plugin in **Settings** → **Community plugins**

---

## Usage

### Getting Started

1. Enable the plugin in **Settings** → **Community plugins**
2. Add `mode: novel` to the frontmatter of any note you want to use as a novel manuscript
3. Open **Settings** → **Novels Note JP** to configure fonts, colors, ruby style, and other options

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

### Adding Ruby Annotation
1. Select the text you want to annotate in the editor
2. Right-click to open the context menu
3. Choose **ルビを振る** to open the ruby input dialog, enter the reading, and click **挿入**
4. Or choose **傍点を振る** to apply emphasis dots immediately

### Vertical Preview
Use the command palette (`Ctrl/Cmd + P`) and run **Novels Note JP: 縦書きプレビューを開く** to open the tate-gumi preview panel.

### Novel Reading View
Run **Novels Note JP: 小説閲覧ビューを開く** from the command palette to switch the current note to the clean reading view.

### Export
Run **Novels Note JP: 現在のファイルを原稿 Export する** from the command palette to open the export dialog.

---

## Settings

| Setting | Description |
|---|---|
| Font size | Font size for novel-mode editors |
| Line height | Line height for novel-mode editors |
| Wrap column | Number of full-width characters per line |
| Show guideline | Enable/disable the line-wrap ruler, with color, opacity, and style options |
| Full-width space visualization | Enable/disable, with display style (dot / underline / box) and color options |
| Highlight: Global toggle | Enable or disable all highlighting |
| Category colors / toggles | Color and enable/disable per term category |
| Bracket colors / toggles | Color and enable/disable per bracket type |
| Ruby notation style | Format used when inserting and rendering ruby annotations (narou / aozora / denden / HTML) |
| Word count mode | Raw / Novel-weighted / Manuscript pages |
| Word count options | Whether to include full-width spaces, blank lines, and hashtags in the count |
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

日本語小説の執筆に特化した Obsidian プラグインです。`.txt` ファイルのサポート、縦書きプレビュー、用語ハイライト、ルビ入力、原稿エクスポートなど、小説執筆ワークフローに必要な機能を提供します。

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
- **全角スペースの可視化**（誤入力を防止）。表示スタイルはドット・下線・ボーダーから選択可能
- **段落自動字下げ**
- **折り返し桁数の設定**とビジュアル定規（色・不透明度・実線/破線を設定可能）
- **`.txt` ファイル対応** — プレーンテキストファイルを直接編集可能

### ルビ・傍点の入力
エディター上でテキストを選択して右クリックするとコンテキストメニューに項目が表示されます。

- **ルビを振る** — 選択テキストに対してルビ入力ダイアログが開きます。読み仮名を入力するとリアルタイムで HTML プレビューが更新され、「挿入」ボタンで設定のルビ方式に従った記法で挿入されます。
- **傍点を振る** — 選択した文字列の各文字に「・」を傍点として即座に挿入します。

ルビ記法はエディター上でも HTML の `<ruby>` 要素としてインラインレンダリングされるため、執筆中も読みやすい表示で確認できます。

対応しているルビ記法は以下の4種類です（設定で統一的に切り替え可能）：

| 方式 | 記法 |
|---|---|
| なろう式 | `\|漢字《ルビ》`（半角縦棒） |
| 青空文庫式 | `｜漢字《ルビ》`（全角縦棒） |
| でんでん式 | `{漢字\|ルビ}` |
| HTML | `<ruby>漢字<rt>ルビ</rt></ruby>` |

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
- **カテゴリ・フォルダを右クリック** → そのフォルダに用語ノートを新規作成
- **用語を右クリック** → ノートを開く・削除（確認ダイアログ付き、ゴミ箱へ移動）
- ドラッグ＆ドロップでフォルダ階層を移動
- ドラッグ＆ドロップでメインペインに用語を挿入（WikiLink 形式）
- 起動時はタグを折りたたんだ状態で表示
- 除外フォルダの設定（オプションにて設定）

用語ノートの新規作成時にフォルダパスを指定できます。指定したフォルダが存在しない場合、作成前に確認ダイアログが表示されます。

### 文字数カウント
3つのカウントモードをステータスバーに表示します：

- **生文字数** — 総文字数
- **小説用重み付き** — 本文のみをカウント（フロントマター・タグ・WikiLink 等を除外）
- **原稿用紙換算** — 400字詰め原稿用紙換算枚数

全角スペース・空行・ハッシュタグをカウントに含めるかどうかもオプションで設定できます。

### 縦書きプレビュー
現在のノートを縦書きレイアウトでプレビューします。

- エディターとプレビュー間のカーソル位置同期
- ルビ表記をまたいだ選択範囲のハイライト保持
- カーソル行ハイライト（色とオン/オフを設定可能）
- ツールバーにエクスポートボタン配置

![verticalPreview](docs/verticalPreview.png)

### 小説閲覧ビュー
WikiLink・タグ・本文以外のコンテンツを除去したクリーンな閲覧ビューです。ノベルモードでないファイルにはポップアップで通知します。編集ボタンの隣にエクスポートボタンも配置されています。

![novelReadingView](docs/novelReadingView.png)

### エクスポート
専用のエクスポートダイアログから、現在のノートをクリーンな原稿テキストとして出力します。

- Markdown・Obsidian 記法（WikiLink、タグ、フロントマターなど）を除去
- 出力形式（`.txt` / `.md`）を選択可能
- ルビ記法の扱いを選択可能（保持／他方式へ変換 / 親文字のみ残して除去）
- 連続する空行を1行に圧縮するオプション
- コマンドパレットから常に実行可能
- **元のファイルは一切変更されません**

![export-document](docs/export-document.png)

---

## インストール

### コミュニティプラグインから（推奨）
1. **設定** → **コミュニティプラグイン** → **閲覧** を開く
2. **Novels Note JP** を検索
3. **インストール** → **有効化**

### 手動インストール
1. [最新リリース](https://github.com/p77-don/novels-note-jp/releases)から `main.js`、`manifest.json`、`styles.css` をダウンロード
2. Vault のプラグインフォルダへコピー：`<vault>/.obsidian/plugins/novels-note-jp/`
3. Obsidian を再起動し、**設定** → **コミュニティプラグイン** でプラグインを有効化

---

## 基本的な使い方

1. プラグインを有効化する
2. 原稿として使用したいノートのフロントマターに `mode: novel` を追加する
3. **設定** → **Novels Note JP** でハイライト色・ルビ方式・用語カテゴリなどを設定する

### ルビ・傍点の入力
1. エディターでルビを付けたい文字列を選択する
2. 右クリックしてコンテキストメニューを開く
3. **ルビを振る** を選択してダイアログで読み仮名を入力し、「挿入」をクリック
4. または **傍点を振る** を選択して即座に傍点を適用する

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

## 設定一覧

| 設定項目 | 説明 |
|---|---|
| フォントサイズ | ノベルモードのエディターで使用するフォントサイズ |
| 行間 | ノベルモードのエディターで使用する行間 |
| 折り返し桁数 | 1行あたりの全角文字数 |
| 定規の表示 | 折り返し位置の定規の表示/非表示（色・不透明度・実線/破線） |
| 全角スペースの可視化 | 表示/非表示の切り替えと、スタイル（ドット・下線・ボーダー）・色の設定 |
| ハイライト：全体トグル | すべてのハイライト機能の一括オン/オフ |
| カテゴリカラー・トグル | 用語カテゴリごとの色とオン/オフ |
| 括弧カラー・トグル | 括弧の種類ごとの色とオン/オフ |
| ルビ記法 | ルビ入力・インラインレンダリング・エクスポートに使用する記法（なろう式 / 青空文庫式 / でんでん式 / HTML） |
| 文字数カウントモード | 生文字数 / 小説用重み付き / 原稿用紙換算 |
| 文字数カウントオプション | 全角スペース・空行・ハッシュタグをカウントに含めるか |
| 縦書きプレビューのカーソルハイライト | カーソル行の背景色とオン/オフ |
| 除外フォルダ | 用語インデックスから除外するフォルダ |

---

## 動作環境

- Obsidian v1.4.0 以降
- デスクトップ版のみ（Node.js API を使用）
