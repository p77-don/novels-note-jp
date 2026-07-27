// ─────────────────────────────────────────
// Novels Note JP — 執筆情報一覧 View
//
// 【設計方針】
//   - mode:novel の原稿ノートを vault 全体から検索し、
//     執筆文字数・地の文／会話文の文字数と比率を一覧表示する。
//   - メインエリアの新規タブとして開く（サイドバーではない）。
//   - 上部に「全原稿の合計」サマリーと並び替えツールバーを固定表示し、
//     スクロールしてもその位置に留まる。スクロールするのは
//     ファイル単位カードの一覧部分のみ（flex レイアウトで分離）。
//   - ファイル名クリックでそのノートを開く（Wikilink 的な導線）。
// ─────────────────────────────────────────

import { ItemView, WorkspaceLeaf, TFile, Platform } from "obsidian";
import { WRITING_STATS_VIEW_TYPE, WritingStatsEntry } from "../types";

type SortKey = "name" | "created" | "modified";

// ─────────────────────────────────────────
// 日時フォーマット（YYYY-MM-DD HH:mm）
// ロケール依存を避けるため手動でゼロ埋めする。
// ─────────────────────────────────────────
function formatDateTime(ms: number): string {
  const d = new Date(ms);
  // 現在の tsconfig.json の lib（ES2016）には String.prototype.padStart が
  // 含まれていないため、tsconfig 全体に影響する lib 変更は避け、
  // ここではゼロ埋めを手動で行う。
  const pad = (n: number) => (n < 10 ? "0" + n : String(n));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ─────────────────────────────────────────
// 比率フォーマット（小数点以下1桁）
// 分母が0の場合は "—" を返す。
// ─────────────────────────────────────────
function formatRatio(part: number, total: number): string {
  if (total <= 0) return "—";
  return `${((part / total) * 100).toFixed(1)}%`;
}

export class WritingStatsView extends ItemView {
  private entries: WritingStatsEntry[] = [];
  private sortKey: SortKey = "name";
  private sortAsc = true;
  private loading = true;
  private fetchEntries: () => Promise<WritingStatsEntry[]>;

  constructor(leaf: WorkspaceLeaf, fetchEntries: () => Promise<WritingStatsEntry[]>) {
    super(leaf);
    this.fetchEntries = fetchEntries;
  }

  getViewType(): string    { return WRITING_STATS_VIEW_TYPE; }
  getDisplayText(): string { return "執筆情報一覧"; }
  getIcon(): string        { return "bar-chart-3"; }

  async onOpen(): Promise<void> {
    await this.reload();
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  // ─────────────────────────────────────────
  // データ再取得＋再描画（コマンド再実行・「再集計」ボタンからも呼ばれる）
  // ─────────────────────────────────────────
  async reload(): Promise<void> {
    this.loading = true;
    this.render();

    this.entries = await this.fetchEntries();
    this.loading = false;
    this.render();
  }

  // ─────────────────────────────────────────
  // 描画本体
  //
  // contentEl 自体を flex column にし、
  //   ・headerEl（サマリー＋ツールバー）：flex-shrink: 0（固定）
  //   ・scrollEl（カード一覧）        ：flex: 1、overflow-y: auto（独立スクロール）
  // に分離する。
  // ─────────────────────────────────────────
  private render(): void {
    const container = this.contentEl;
    container.empty();
    container.addClass("nn-stats-view");

    const headerEl = container.createEl("div", { cls: "nn-stats-header" });
    const scrollEl = container.createEl("div", { cls: "nn-stats-scroll" });

    if (this.loading) {
      scrollEl.createEl("p", {
        text: "原稿ノートを集計しています…",
        cls: "nn-stats-loading",
      });
      return;
    }

    // 並び替え＋再集計ボタンはローディング中でなければ常に表示する
    if (this.entries.length === 0) {
      this.renderToolbar(headerEl);
      scrollEl.createEl("p", {
        text: "mode: novel のノートが見つかりませんでした。除外フォルダの設定もあわせてご確認ください。",
        cls: "nn-stats-empty",
      });
      return;
    }

    this.renderSummary(headerEl);
    this.renderToolbar(headerEl);
    this.renderList(scrollEl);
  }

  // ─────────────────────────────────────────
  // 固定ヘッダー：全原稿の合計サマリー（ソート対象外・常時表示）
  // ─────────────────────────────────────────
  private renderSummary(container: HTMLElement): void {
    const totalNotes = this.entries.length;
    let totalChars = 0;
    let narrativeChars = 0;
    let dialogueChars = 0;
    for (const e of this.entries) {
      totalChars += e.totalChars;
      narrativeChars += e.narrativeChars;
      dialogueChars += e.dialogueChars;
    }

    const summary = container.createEl("div", { cls: "nn-stats-summary" });
    summary.createEl("div", { text: "全原稿の合計", cls: "nn-stats-summary-label" });

    const grid = summary.createEl("div", { cls: "nn-stats-summary-grid" });

    const addMetric = (label: string, value: string): void => {
      const metric = grid.createEl("div", { cls: "nn-stats-metric" });
      metric.createEl("div", { text: label, cls: "nn-stats-metric-label" });
      metric.createEl("div", { text: value, cls: "nn-stats-metric-value" });
    };

    addMetric("対象ノート数", `${totalNotes.toLocaleString()} 件`);
    addMetric("執筆文字数", `${totalChars.toLocaleString()} 字`);
    addMetric("地の文", `${narrativeChars.toLocaleString()} 字 (${formatRatio(narrativeChars, totalChars)})`);
    addMetric("会話文", `${dialogueChars.toLocaleString()} 字 (${formatRatio(dialogueChars, totalChars)})`);
  }

  // ─────────────────────────────────────────
  // 固定ヘッダー：並び替えツールバー＋再集計ボタン
  // ─────────────────────────────────────────
  private renderToolbar(container: HTMLElement): void {
    const toolbar = container.createEl("div", {
      cls: "nn-stats-toolbar" + (Platform.isMobile ? " nn-stats-toolbar-mobile" : ""),
    });
    // モバイルは表示領域が限られるため、「並び替え：」のコロンを省略する
    toolbar.createEl("span", {
      text: Platform.isMobile ? "並び替え" : "並び替え:",
      cls: "nn-stats-toolbar-label",
    });

    const addSortButton = (key: SortKey, label: string): void => {
      const isActive = this.sortKey === key;
      const btn = toolbar.createEl("button", {
        text: isActive ? `${label} ${this.sortAsc ? "▲" : "▼"}` : label,
        cls: "nn-stats-sort-btn" + (isActive ? " nn-stats-sort-btn-active" : ""),
      });
      btn.addEventListener("click", () => {
        if (this.sortKey === key) {
          this.sortAsc = !this.sortAsc;
        } else {
          this.sortKey = key;
          this.sortAsc = true;
        }
        this.render();
      });
    };

    addSortButton("name", "ファイル名");
    addSortButton("created", "作成日時");
    addSortButton("modified", "最終更新日時");

    // 再集計ボタン（ソートボタン群の右側に配置）
    // モバイルは表示スペースが限られるため非表示にする。
    // タブを開き直した際は自動的に再集計されるため、
    // 手動での再集計手段がなくても実用上は困らない。
    if (Platform.isMobile) return;

    const refreshBtn = toolbar.createEl("button", {
      text: "再集計",
      cls: "nn-stats-refresh-btn",
    });
    refreshBtn.addEventListener("click", () => {
      void this.reload();
    });
  }

  // ─────────────────────────────────────────
  // スクロール領域：ファイル単位カードの一覧
  // ─────────────────────────────────────────
  private renderList(container: HTMLElement): void {
    const sorted = [...this.entries].sort((a, b) => {
      let cmp = 0;
      if (this.sortKey === "name") {
        cmp = a.fileName.localeCompare(b.fileName, "ja");
      } else if (this.sortKey === "created") {
        cmp = a.createdAt - b.createdAt;
      } else {
        cmp = a.modifiedAt - b.modifiedAt;
      }
      return this.sortAsc ? cmp : -cmp;
    });

    const list = container.createEl("div", { cls: "nn-stats-list" });

    for (const entry of sorted) {
      const card = list.createEl("div", { cls: "nn-stats-card" });

      // 1段目：ファイル名（クリックでノートを開く）＋フォルダパス
      const row1 = card.createEl("div", { cls: "nn-stats-card-row1" });
      const nameLink = row1.createEl("a", {
        text: entry.fileName,
        cls: "nn-stats-card-filename internal-link",
        href: "#",
      });
      nameLink.addEventListener("click", (e: MouseEvent) => {
        e.preventDefault();
        this.openEntryFile(entry);
      });
      row1.createEl("span", {
        text: entry.folderPath ? `${entry.folderPath}/` : "(vault直下)",
        cls: "nn-stats-card-folder",
      });

      // 2段目：作成日時・最終更新日時
      const row2 = card.createEl("div", { cls: "nn-stats-card-row2" });
      row2.createEl("div", { text: `作成: ${formatDateTime(entry.createdAt)}` });
      row2.createEl("div", { text: `更新: ${formatDateTime(entry.modifiedAt)}` });

      // 3段目：執筆文字数・地の文・会話文
      const row3 = card.createEl("div", { cls: "nn-stats-card-row3" });

      const addStat = (label: string, text: string): void => {
        const stat = row3.createEl("div", { cls: "nn-stats-card-stat" });
        stat.createEl("div", { text: label, cls: "nn-stats-card-stat-label" });
        stat.createEl("div", { text, cls: "nn-stats-card-stat-value" });
      };

      addStat("執筆文字数", `${entry.totalChars.toLocaleString()} 字`);
      addStat(
        "地の文",
        `${entry.narrativeChars.toLocaleString()} 字 (${formatRatio(entry.narrativeChars, entry.totalChars)})`
      );
      addStat(
        "会話文",
        `${entry.dialogueChars.toLocaleString()} 字 (${formatRatio(entry.dialogueChars, entry.totalChars)})`
      );
    }
  }

  // ─────────────────────────────────────────
  // ファイル名クリック時：対象ノートを開く
  // 直前にアクティブだったリーフに開く（このView自身は差し替えない）。
  // ─────────────────────────────────────────
  private openEntryFile(entry: WritingStatsEntry): void {
    const file = this.app.vault.getAbstractFileByPath(entry.filePath);
    if (!(file instanceof TFile)) return;
    void this.app.workspace.getLeaf(false).openFile(file);
  }
}
