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
import { estimateReadingMinutes, formatReadingTime } from "../core/readingTime";
import { computeNiceScale } from "../core/chartScale";

type SortKey = "name" | "created" | "modified" | "chars";
type ViewMode = "list" | "chart";

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

// ─────────────────────────────────────────
// 地の文／会話文比率の円グラフ（conic-gradient）
//
// 割合は setCssProps() でCSSカスタムプロパティとして渡す
// （obsidianmd/no-static-styles-assignment 対応：.style への直接代入は行わない）。
// 実際の conic-gradient の組み立ては styles.css 側（.nn-stats-pie）で行う。
//
// 色の凡例は表示せず、「地の文」「会話文」ラベルの前に付ける●（ドット）
// 側で色を示す（renderColorDot を参照）。
//
// @param mini true の場合、原稿カード用の小サイズ表示にする。
// ─────────────────────────────────────────
function renderPieChart(
  container: HTMLElement,
  narrativeChars: number,
  dialogueChars: number,
  mini: boolean
): void {
  const total = narrativeChars + dialogueChars;
  const narrativePercent = total > 0 ? (narrativeChars / total) * 100 : 0;

  const pie = container.createDiv({
    cls: "nn-stats-pie" + (mini ? " nn-stats-pie-mini" : ""),
  });
  pie.setCssProps({
    "--nn-pie-percent": total > 0 ? `${narrativePercent}%` : "0%",
  });
}

// ─────────────────────────────────────────
// ラベル用の色ドット（●）
//
// 円グラフと同じ色（--nn-pie-narrative-color / --nn-pie-dialogue-color）を
// 小さな丸として付与し、背景色によるバッジ表示ではなく、
// ラベル横の色識別のみで見た目のバランスを保つ。
// ─────────────────────────────────────────
function renderColorDot(labelEl: HTMLElement, colorClass: string): void {
  labelEl.createSpan({ cls: `nn-stats-label-dot ${colorClass}` });
}

export class WritingStatsView extends ItemView {
  private entries: WritingStatsEntry[] = [];
  private sortKey: SortKey = "name";
  private sortAsc = true;
  private viewMode: ViewMode = "list";
  private loading = true;
  // ファイル名・フォルダ名を対象にした絞り込みキーワード
  private filterText = "";
  private fetchEntries: () => Promise<WritingStatsEntry[]>;
  private getReadingSpeed: () => number;

  // 絞り込み時に「合計サマリー」「一覧／グラフ」だけを部分再描画するための
  // コンテナ参照。並び替えツールバー（検索ボックスを含む）自体は
  // render() でしか作り直さないため、検索ボックスへの入力のたびに
  // this.render() を呼ぶと入力欄自体が毎回作り直されてフォーカスが
  // 外れてしまう（＝1文字打つたびに入力が止まる）。これを避けるため、
  // 検索ボックスの input イベントでは refreshFiltered() のみを呼び、
  // 検索ボックスを含むツールバーそのものは再生成しない。
  private summaryContainerEl: HTMLElement | null = null;
  private scrollEl: HTMLElement | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    fetchEntries: () => Promise<WritingStatsEntry[]>,
    getReadingSpeed: () => number
  ) {
    super(leaf);
    this.fetchEntries = fetchEntries;
    this.getReadingSpeed = getReadingSpeed;
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
    // モバイルでは「すべての原稿の情報」（サマリー）を上部固定にせず、
    // ヘッダーと一覧をまとめて1つのスクロール領域として扱う
    // （個別ファイル情報の表示スペースが原稿1件分しかなくなってしまう
    // のを避けるため）。PC版は従来通り、サマリーを固定ヘッダーとして
    // 残し、一覧のみを独立スクロールさせる。
    if (Platform.isMobile) container.addClass("nn-stats-view-mobile");

    const headerEl = container.createDiv({ cls: "nn-stats-header" });
    const scrollEl = container.createDiv({ cls: "nn-stats-scroll" });
    this.scrollEl = scrollEl;
    this.summaryContainerEl = null;

    if (this.loading) {
      scrollEl.createEl("p", {
        text: "原稿ノートを集計しています…",
        cls: "nn-stats-loading",
      });
      return;
    }

    // 並び替え＋再集計ボタンはローディング中でなければ常に表示する
    if (this.entries.length === 0) {
      this.renderViewToggle(headerEl);
      this.renderToolbar(headerEl);
      scrollEl.createEl("p", {
        text: "mode: novel のノートが見つかりませんでした。除外フォルダの設定もあわせてご確認ください。",
        cls: "nn-stats-empty",
      });
      return;
    }

    // サマリーは絞り込みのたびに再計算するため、専用コンテナに分離しておく
    // （renderToolbar 内の検索ボックスとは独立に refreshFiltered() から再描画する）。
    this.summaryContainerEl = headerEl.createDiv();
    this.renderSummary(this.summaryContainerEl);

    this.renderViewToggle(headerEl);
    this.renderToolbar(headerEl);

    this.renderBody();
  }

  // ─────────────────────────────────────────
  // スクロール領域（一覧／グラフ）のみを再描画する
  // 絞り込みキーワード変更時（refreshFiltered）・並び替え変更時
  // （render() 経由）の両方から呼ばれる。
  // ─────────────────────────────────────────
  private renderBody(): void {
    if (!this.scrollEl) return;
    const scrollEl = this.scrollEl;
    scrollEl.empty();

    const filtered = this.getFilteredEntries();

    if (filtered.length === 0) {
      scrollEl.createEl("p", {
        text: "絞り込み条件に一致する原稿が見つかりませんでした。",
        cls: "nn-stats-empty",
      });
      return;
    }

    if (this.viewMode === "list") {
      this.renderList(scrollEl, filtered);
    } else {
      this.renderChart(scrollEl, filtered);
    }
  }

  // ─────────────────────────────────────────
  // 絞り込みキーワード変更時：検索ボックス自体は再生成せず、
  // 合計サマリーと一覧／グラフだけを部分再描画する
  // （入力欄のフォーカスを維持するため）。
  // ─────────────────────────────────────────
  private refreshFiltered(): void {
    if (this.summaryContainerEl) {
      this.summaryContainerEl.empty();
      this.renderSummary(this.summaryContainerEl);
    }
    this.renderBody();
  }

  // ─────────────────────────────────────────
  // 絞り込みキーワードを適用したエントリ一覧を返す
  // （ファイル名・フォルダ名を対象に、大文字小文字を区別しない部分一致）
  // ─────────────────────────────────────────
  private getFilteredEntries(): WritingStatsEntry[] {
    const query = this.filterText.trim().toLowerCase();
    if (!query) return this.entries;
    return this.entries.filter(e =>
      e.fileName.toLowerCase().includes(query) ||
      e.folderPath.toLowerCase().includes(query)
    );
  }

  // ─────────────────────────────────────────
  // 現在の並び替え条件を適用したエントリ一覧を返す
  // （一覧表示・グラフ表示の両方から共通で利用する）
  // 対象は呼び出し側で絞り込み済みのエントリ一覧
  // （getFilteredEntries() の結果）を渡す。
  // ─────────────────────────────────────────
  private getSortedEntries(entries: WritingStatsEntry[]): WritingStatsEntry[] {
    return [...entries].sort((a, b) => {
      let cmp = 0;
      if (this.sortKey === "name") {
        cmp = a.fileName.localeCompare(b.fileName, "ja");
      } else if (this.sortKey === "created") {
        cmp = a.createdAt - b.createdAt;
      } else if (this.sortKey === "modified") {
        cmp = a.modifiedAt - b.modifiedAt;
      } else {
        cmp = a.totalChars - b.totalChars;
      }
      return this.sortAsc ? cmp : -cmp;
    });
  }

  // ─────────────────────────────────────────
  // 固定ヘッダー：表示切替（各原稿詳細／文字数グラフ）＋再集計ボタン
  // 「各原稿詳細」「文字数グラフ」「再集計」の順に並べる。
  // 再集計ボタンはモバイルでは表示領域が限られるため非表示にする
  // （タブを開き直せば自動的に再集計されるため、実用上困らない）。
  // ─────────────────────────────────────────
  private renderViewToggle(container: HTMLElement): void {
    const toggle = container.createDiv({ cls: "nn-stats-viewmode-toggle" });

    // 下段の「並び替え:」とラベルの見た目を揃える
    // （同じCSSクラス・モバイルでのコロン省略ルールを流用）
    toggle.createSpan({
      text: Platform.isMobile ? "表示切替" : "表示切替:",
      cls: "nn-stats-toolbar-label",
    });

    const addToggleButton = (mode: ViewMode, label: string): void => {
      const isActive = this.viewMode === mode;
      const btn = toggle.createEl("button", {
        text: label,
        cls: "nn-stats-viewmode-btn" + (isActive ? " nn-stats-viewmode-btn-active" : ""),
      });
      btn.addEventListener("click", () => {
        if (this.viewMode === mode) return;
        this.viewMode = mode;
        this.render();
      });
    };

    addToggleButton("list", "各原稿詳細");
    addToggleButton("chart", "文字数グラフ");

    if (Platform.isMobile) return;

    const refreshBtn = toggle.createEl("button", {
      text: "再集計",
      cls: "nn-stats-refresh-btn",
    });
    refreshBtn.addEventListener("click", () => {
      void this.reload();
    });
  }

  // ─────────────────────────────────────────
  // 固定ヘッダー：全原稿の合計サマリー（ソート対象外・常時表示）
  // 絞り込みキーワードが指定されている場合は、絞り込み後のエントリ
  // のみを対象に合計を再計算する（全原稿の合計ではなく「絞り込み結果の
  // 合計」になる。ラベル文言は変えず、対象ノート数の増減で反映される）。
  // ─────────────────────────────────────────
  private renderSummary(container: HTMLElement): void {
    const filtered = this.getFilteredEntries();
    const totalNotes = filtered.length;
    let totalChars = 0;
    let narrativeChars = 0;
    let dialogueChars = 0;
    let novelChars = 0;
    let totalPages = 0;
    for (const e of filtered) {
      totalChars += e.totalChars;
      narrativeChars += e.narrativeChars;
      dialogueChars += e.dialogueChars;
      novelChars += e.novelChars;
      totalPages += e.pageEquivalent;
    }

    const summary = container.createDiv({ cls: "nn-stats-summary" });
    summary.createDiv({ text: "全原稿の合計", cls: "nn-stats-summary-label" });

    const body = summary.createDiv({ cls: "nn-stats-summary-body" });
    const rows = body.createDiv({ cls: "nn-stats-summary-rows" });
    const topRow = rows.createDiv({ cls: "nn-stats-summary-grid" });
    const bottomRow = rows.createDiv({ cls: "nn-stats-summary-grid" });

    const addMetric = (grid: HTMLElement, label: string, value: string, dotColorClass?: string): void => {
      const metric = grid.createDiv({ cls: "nn-stats-metric" });
      const labelEl = metric.createDiv({ cls: "nn-stats-metric-label" });
      if (dotColorClass) renderColorDot(labelEl, dotColorClass);
      labelEl.createSpan({ text: label });
      metric.createDiv({ text: value, cls: "nn-stats-metric-value" });
    };

    const readingMinutes = estimateReadingMinutes(novelChars, this.getReadingSpeed());

    // 上段：対象ノート数・総ページ数・推定読了時間
    addMetric(topRow, "対象ノート数", `${totalNotes.toLocaleString()} 件`);
    addMetric(topRow, "総ページ数", `${totalPages.toLocaleString()} 枚`);
    addMetric(topRow, "推定読了時間", formatReadingTime(readingMinutes));

    // 下段：執筆文字数・地の文・会話文
    addMetric(bottomRow, "執筆文字数", `${totalChars.toLocaleString()} 字`);
    addMetric(
      bottomRow,
      "地の文",
      `${narrativeChars.toLocaleString()} 字 (${formatRatio(narrativeChars, totalChars)})`,
      "nn-stats-label-dot-narrative"
    );
    addMetric(
      bottomRow,
      "会話文",
      `${dialogueChars.toLocaleString()} 字 (${formatRatio(dialogueChars, totalChars)})`,
      "nn-stats-label-dot-dialogue"
    );

    renderPieChart(body, narrativeChars, dialogueChars, false);
  }

  // ─────────────────────────────────────────
  // 固定ヘッダー：並び替えツールバー
  // ─────────────────────────────────────────
  private renderToolbar(container: HTMLElement): void {
    const toolbar = container.createDiv({
      cls: "nn-stats-toolbar" + (Platform.isMobile ? " nn-stats-toolbar-mobile" : ""),
    });
    // モバイルは表示領域が限られるため、「並び替え：」のコロンを省略する
    toolbar.createSpan({
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
    addSortButton("chars", "文字数");

    // 「文字数」ボタンの右側に、ファイル名・フォルダ名で絞り込むための
    // 検索ボックスを配置する。入力のたびに render() 全体を呼び直すと
    // この入力欄自体が作り直されてフォーカスが外れてしまうため、
    // input イベントでは refreshFiltered()（部分再描画）のみを呼ぶ。
    const filterWrap = toolbar.createDiv({ cls: "nn-stats-filter-wrap" });
    const filterInput = filterWrap.createEl("input", {
      type: "text",
      placeholder: "ファイル名・フォルダ名で絞り込み",
      cls: "nn-stats-filter-input",
    });
    filterInput.value = this.filterText;

    const clearBtn = filterWrap.createEl("button", {
      cls: "nn-stats-filter-clear",
      title: "絞り込みをクリア",
      text: "✕",
    });
    clearBtn.toggleClass("nn-hidden", !this.filterText);

    filterInput.addEventListener("input", () => {
      this.filterText = filterInput.value;
      clearBtn.toggleClass("nn-hidden", !this.filterText);
      this.refreshFiltered();
    });

    clearBtn.addEventListener("click", () => {
      filterInput.value = "";
      this.filterText = "";
      clearBtn.addClass("nn-hidden");
      filterInput.focus();
      this.refreshFiltered();
    });
  }

  // ─────────────────────────────────────────
  // スクロール領域：ファイル単位カードの一覧
  // entries は呼び出し側（renderBody）で絞り込み済みのエントリ一覧
  // ─────────────────────────────────────────
  private renderList(container: HTMLElement, entries: WritingStatsEntry[]): void {
    const sorted = this.getSortedEntries(entries);

    const list = container.createDiv({ cls: "nn-stats-list" });

    for (const entry of sorted) {
      const card = list.createDiv({ cls: "nn-stats-card" });

      // 1段目：ファイル名（クリックでノートを開く）＋フォルダパス
      const row1 = card.createDiv({ cls: "nn-stats-card-row1" });
      const nameLink = row1.createEl("a", {
        text: entry.fileName,
        cls: "nn-stats-card-filename internal-link",
        href: "#",
      });
      nameLink.addEventListener("click", (e: MouseEvent) => {
        e.preventDefault();
        this.openEntryFile(entry);
      });
      row1.createSpan({
        text: entry.folderPath ? `${entry.folderPath}/` : "(vault直下)",
        cls: "nn-stats-card-folder",
      });

      // 2段目：作成日時・最終更新日時
      const row2 = card.createDiv({ cls: "nn-stats-card-row2" });
      row2.createDiv({ text: `作成: ${formatDateTime(entry.createdAt)}` });
      row2.createDiv({ text: `更新: ${formatDateTime(entry.modifiedAt)}` });

      // 3段目：執筆文字数・ページ数・推定読了時間（上段）／
      //        地の文・会話文（下段）＋円グラフ
      const row3 = card.createDiv({ cls: "nn-stats-card-row3" });

      const statsRows = row3.createDiv({ cls: "nn-stats-card-stats-rows" });
      const topStatsRow = statsRows.createDiv({ cls: "nn-stats-card-stats nn-stats-card-stats-top" });
      const bottomStatsRow = statsRows.createDiv({ cls: "nn-stats-card-stats nn-stats-card-stats-bottom" });

      const addStat = (statsCol: HTMLElement, label: string, text: string, dotColorClass?: string): void => {
        const stat = statsCol.createDiv({ cls: "nn-stats-card-stat" });
        const labelEl = stat.createDiv({ cls: "nn-stats-card-stat-label" });
        if (dotColorClass) renderColorDot(labelEl, dotColorClass);
        labelEl.createSpan({ text: label });
        stat.createDiv({ text, cls: "nn-stats-card-stat-value" });
      };

      const readingMinutes = estimateReadingMinutes(entry.novelChars, this.getReadingSpeed());

      // 上段：執筆文字数・ページ数・推定読了時間
      addStat(topStatsRow, "執筆文字数", `${entry.totalChars.toLocaleString()} 字`);
      addStat(topStatsRow, "ページ数", `${entry.pageEquivalent.toLocaleString()} 枚`);
      addStat(topStatsRow, "推定読了時間", formatReadingTime(readingMinutes));

      // 下段：地の文・会話文
      addStat(
        bottomStatsRow,
        "地の文",
        `${entry.narrativeChars.toLocaleString()} 字 (${formatRatio(entry.narrativeChars, entry.totalChars)})`,
        "nn-stats-label-dot-narrative"
      );
      addStat(
        bottomStatsRow,
        "会話文",
        `${entry.dialogueChars.toLocaleString()} 字 (${formatRatio(entry.dialogueChars, entry.totalChars)})`,
        "nn-stats-label-dot-dialogue"
      );

      renderPieChart(row3, entry.narrativeChars, entry.dialogueChars, true);
    }
  }

  // ─────────────────────────────────────────
  // スクロール領域：グラフ表示（積み上げ棒グラフ）
  //
  // 各原稿を「地の文＋会話文＝総文字数」の1本の棒として表示し、
  // 原稿間の分量差を比較できるようにする。目盛り軸の最大値を
  // 基準にバーの幅（%）を算出し、setCssProps() でCSSカスタム
  // プロパティとして渡す（.style への直接代入は行わない）。
  // entries は呼び出し側（renderBody）で絞り込み済みのエントリ一覧
  // ─────────────────────────────────────────
  private renderChart(container: HTMLElement, entries: WritingStatsEntry[]): void {
    const sorted = this.getSortedEntries(entries);
    const maxTotal = Math.max(0, ...sorted.map(e => e.totalChars));
    const scale = computeNiceScale(maxTotal);

    const chart = container.createDiv({ cls: "nn-stats-chart" });

    // 凡例
    const legend = chart.createDiv({ cls: "nn-stats-chart-legend" });
    const addLegendItem = (dotClass: string, label: string): void => {
      const item = legend.createSpan({ cls: "nn-stats-chart-legend-item" });
      item.createSpan({ cls: `nn-stats-label-dot ${dotClass}` });
      item.createSpan({ text: label });
    };
    addLegendItem("nn-stats-label-dot-narrative", "地の文");
    addLegendItem("nn-stats-label-dot-dialogue", "会話文");

    if (scale.max <= 0) {
      chart.createEl("p", {
        text: "文字数が0のため、グラフを表示できません。",
        cls: "nn-stats-empty",
      });
      return;
    }

    // 目盛り軸（0・step・2×step…）
    const axisRow = chart.createDiv({ cls: "nn-stats-chart-row nn-stats-chart-axis-row" });
    axisRow.createDiv({ cls: "nn-stats-chart-label" });
    const axisTrack = axisRow.createDiv({ cls: "nn-stats-chart-axis-track" });
    for (const tick of scale.ticks) {
      const tickEl = axisTrack.createDiv({ cls: "nn-stats-chart-tick" });
      tickEl.setCssProps({ "--nn-tick-left": `${(tick / scale.max) * 100}%` });
      tickEl.createDiv({ cls: "nn-stats-chart-tick-line" });
      tickEl.createDiv({ text: tick.toLocaleString(), cls: "nn-stats-chart-tick-label" });
    }
    axisRow.createDiv({ cls: "nn-stats-chart-value" });

    // 各原稿の棒
    const rows = chart.createDiv({ cls: "nn-stats-chart-rows" });
    for (const entry of sorted) {
      const row = rows.createDiv({ cls: "nn-stats-chart-row" });

      const label = row.createEl("a", {
        text: entry.fileName,
        cls: "nn-stats-chart-label internal-link",
        href: "#",
      });
      label.setAttr("title", entry.fileName);
      label.addEventListener("click", (e: MouseEvent) => {
        e.preventDefault();
        this.openEntryFile(entry);
      });

      const barArea = row.createDiv({ cls: "nn-stats-chart-bar-area" });
      const narrativePct = (entry.narrativeChars / scale.max) * 100;
      const dialoguePct = (entry.dialogueChars / scale.max) * 100;

      const narrativeSeg = barArea.createDiv({
        cls: "nn-stats-chart-bar-segment nn-stats-chart-bar-narrative",
      });
      narrativeSeg.setCssProps({ "--nn-bar-width": `${narrativePct}%` });

      const dialogueSeg = barArea.createDiv({
        cls: "nn-stats-chart-bar-segment nn-stats-chart-bar-dialogue",
      });
      dialogueSeg.setCssProps({ "--nn-bar-width": `${dialoguePct}%` });

      row.createDiv({
        text: `${entry.totalChars.toLocaleString()} 字`,
        cls: "nn-stats-chart-value",
      });
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
