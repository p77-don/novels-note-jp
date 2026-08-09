// ─────────────────────────────────────────
// Novels Note JP — 用語入力パレット View
//
// カーソル位置に表示するポップアップの中身（パンくず・階層リスト・
// 検索結果・入力ボタン）を描画する。CM6 側（editor/glossaryPalette.ts）から
// 渡された TermEntry[] / CategoryNode[] / 履歴（最近使った）を元に、
// 「どの階層を今表示しているか」を自分で保持してナビゲーションする。
//
// キー操作・マウス操作の受け口はすべてこのクラスの public メソッド
// （moveSelection / navigateInto / navigateBack / confirmSelection）で、
// editor/glossaryPalette.ts はキーイベントをここに委譲するだけにする。
// ─────────────────────────────────────────

import { TermEntry } from "../types";
import { CategoryNode, FolderNode } from "../core/termTree";

// ─────────────────────────────────────────
// カテゴリ（タグ）ごとのアイコン
// 未知のタグ（ユーザー独自定義）は汎用アイコンにフォールバックする
// ─────────────────────────────────────────
const CATEGORY_ICONS: Record<string, string> = {
  character: "👨",
  location: "🌏",
  glossary: "📙",
  organization: "🏢",
  item: "📦",
};

function iconForTag(tag: string): string {
  return CATEGORY_ICONS[tag] ?? "📗";
}

function fileBaseName(filePath: string): string {
  const last = filePath.split("/").pop() ?? filePath;
  return last.replace(/\.md$/, "");
}

// ─────────────────────────────────────────
// ナビゲーション状態（パンくずの各段）
// ─────────────────────────────────────────
type PathSegment =
  | { kind: "root" }
  | { kind: "recent" }
  | { kind: "category-list" }
  | { kind: "all" }
  | { kind: "category"; node: CategoryNode }
  | { kind: "folder"; node: FolderNode; categoryNode: CategoryNode }
  | { kind: "term"; term: TermEntry };

// ─────────────────────────────────────────
// 画面上の1行
// ─────────────────────────────────────────
interface Row {
  icon: string;
  label: string;
  /**
   * Enter／入力ボタンで常にそのまま挿入される文字列。
   * カテゴリ・フォルダ行でも「そのラベル文字列」を持つ
   * （フォルダ名自体を入力したい場合があるため）。
   */
  insertText: string;
  /** 階層を持つ行（→キー／クリックでのみ使う。Enter／入力ボタンでは使わない） */
  navigate?: () => void;
  /** insertText 確定時、履歴記録に使うファイルパス（用語ファイルに対応する行のみ） */
  filePath?: string;
  /** 選択不可（空状態メッセージなど） */
  disabled?: boolean;
}

export interface GlossaryPaletteCallbacks {
  onInsert: (text: string, filePath: string) => void;
  onClose: () => void;
}

export class GlossaryPaletteView {
  private headerEl!: HTMLElement;
  private backBtn!: HTMLButtonElement;
  private closeBtn: HTMLButtonElement | null = null;
  private searchClearBtn!: HTMLButtonElement;
  private breadcrumbEl!: HTMLElement;
  private searchInputEl!: HTMLInputElement;
  private listEl!: HTMLElement;
  private footerEl!: HTMLElement;
  private insertBtn!: HTMLButtonElement;

  private path: PathSegment[] = [{ kind: "root" }];
  // フォーカス直後の短い猶予期間（この時刻までのinputイベントは無視する）
  private ignoreInputUntil = 0;
  private query = "";
  private rows: Row[] = [];
  private selectedIndex = 0;

  constructor(
    private rootEl: HTMLElement,
    private categories: CategoryNode[],
    private recentFilePaths: string[],
    private allTerms: TermEntry[],
    private callbacks: GlossaryPaletteCallbacks,
    /**
     * true の場合、外枠の見た目（背景・枠線・影）を付けない。
     * Obsidian標準の Modal（モバイル）内に描画する場合、Modal自身が
     * 既にその見た目を提供しているため、二重の箱に見えてしまうのを防ぐ。
     */
    private chromeless = false
  ) {
    this.buildSkeleton();
    this.render();
  }

  // ─────────────────────────────────────────
  // 骨組み構築（一度だけ）
  // ─────────────────────────────────────────
  private buildSkeleton(): void {
    this.rootEl.addClass(this.chromeless ? "nn-glossary-palette-content" : "nn-glossary-palette");

    this.headerEl = this.rootEl.createDiv({ cls: "nn-glossary-header" });

    // ヘッダーの余白部分（ボタンやパンくずのリンク以外）をタップした際に、
    // 検索欄からフォーカスを外してソフトウェアキーボードを閉じられる
    // ようにする。ボタン・パンくずリンク自体は個別に stopPropagation()
    // しているため、ここには「余白」をタップした時だけ届く。
    // モバイルでは検索欄に自動フォーカスしない設計にしたが、ユーザーが
    // 検索欄を自らタップしてキーボードを開いた後、閉じる手段が
    // 必要なため（Obsidian側の「モーダル外タップで閉じる」挙動が
    // 当てにならない場合があるため、明示的に用意する）。
    this.headerEl.addEventListener("mousedown", () => {
      const active = this.rootEl.ownerDocument.activeElement;
      if (active === this.searchInputEl) {
        this.searchInputEl.blur();
      }
    });

    this.backBtn = this.headerEl.createEl("button", {
      text: "←",
      cls: "nn-glossary-back-btn",
      attr: { "aria-label": "親階層へ戻る" },
    });
    this.backBtn.addEventListener("mousedown", e => {
      e.preventDefault();
      e.stopPropagation();
      this.navigateBack();
    });

    this.breadcrumbEl = this.headerEl.createDiv({ cls: "nn-glossary-breadcrumb" });

    // chromeless（モバイルのObsidian標準Modal内）の場合、Modal自身が
    // 既に閉じるボタンを持っているため、ここでは重ねて表示しない
    // （閉じるボタンが2つ並んで見え、検索クリアボタンと混同される
    //  問題があったため）。
    if (!this.chromeless) {
      this.closeBtn = this.headerEl.createEl("button", {
        text: "✕",
        cls: "nn-glossary-close-btn",
        attr: { "aria-label": "パレットを閉じる" },
      });
      this.closeBtn.addEventListener("mousedown", e => {
        e.preventDefault();
        e.stopPropagation();
        this.callbacks.onClose();
      });
    }

    // 検索入力欄。
    // 以前はエディタ本文に直接タイプした文字をクエリとして使っていたが、
    // 「入力欄がどこにあるか分かりにくい」「モバイルでソフトキーボードの
    // 挙動と噛み合わない」という問題があったため、パレット自身が
    // 通常の <input> を持つ方式に変更した。実際の<input>要素であれば、
    // OSのソフトウェアキーボードとの連携（表示・回避）はブラウザ／
    // WebViewの標準機能に任せられる。
    const searchWrap = this.rootEl.createDiv({ cls: "nn-glossary-search-wrap" });
    this.searchInputEl = searchWrap.createEl("input", {
      type: "text",
      placeholder: "検索（用語名・別名で絞り込み）",
      cls: "nn-glossary-search-input",
    });
    this.searchClearBtn = searchWrap.createEl("button", {
      text: "✕",
      cls: "nn-glossary-search-clear-btn",
      attr: { "aria-label": "検索文字をクリア" },
    });
    this.searchClearBtn.addEventListener("mousedown", e => {
      e.preventDefault();
      e.stopPropagation();
      this.searchInputEl.value = "";
      this.setQuery("");
      this.searchInputEl.focus();
    });
    this.searchInputEl.addEventListener("input", () => {
      // フォーカス直後の短い猶予期間中に紛れ込んだ文字（トリガー文字が
      // フォーカス移動のタイミングと重なって検索欄に入ってしまう問題）を
      // 確実に無視する。focusInput() 側での一度きりのクリアだけでは
      // タイミングによって間に合わないことがあったため、input イベント
      // 側でも同様にガードする。
      if (Date.now() < this.ignoreInputUntil) {
        this.searchInputEl.value = "";
        return;
      }
      this.setQuery(this.searchInputEl.value);
    });
    this.searchInputEl.addEventListener("keydown", e => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          this.moveSelection(1);
          break;
        case "ArrowUp":
          e.preventDefault();
          this.moveSelection(-1);
          break;
        case "ArrowRight":
          // カーソルが検索文字列の末尾にある時だけ階層移動として扱う。
          // 文中にカーソルがある場合は通常通りテキストカーソルを進める。
          if (
            this.searchInputEl.selectionStart === this.searchInputEl.value.length &&
            this.searchInputEl.selectionEnd === this.searchInputEl.value.length
          ) {
            e.preventDefault();
            this.navigateInto();
          }
          break;
        case "ArrowLeft":
          // カーソルが先頭にある時だけ親階層へ戻る。
          if (this.searchInputEl.selectionStart === 0 && this.searchInputEl.selectionEnd === 0) {
            e.preventDefault();
            this.navigateBack();
          }
          break;
        case "Enter":
          e.preventDefault();
          this.confirmSelection();
          break;
        case "Escape":
          e.preventDefault();
          this.callbacks.onClose();
          break;
        default:
          // それ以外のキーは通常通り入力欄の編集に使わせる
          break;
      }
    });

    this.listEl = this.rootEl.createDiv({ cls: "nn-glossary-list" });
    this.listEl.addEventListener("mousedown", e => {
      // 行自体のクリックは stopPropagation() されているため、
      // ここに届くのは行と行の間・下の余白をタップした場合のみ。
      if (e.target !== this.listEl) return;
      const active = this.rootEl.ownerDocument.activeElement;
      if (active === this.searchInputEl) this.searchInputEl.blur();
    });

    this.footerEl = this.rootEl.createDiv({ cls: "nn-glossary-footer" });
    this.footerEl.addEventListener("mousedown", e => {
      if (e.target !== this.footerEl) return;
      const active = this.rootEl.ownerDocument.activeElement;
      if (active === this.searchInputEl) this.searchInputEl.blur();
    });
    this.insertBtn = this.footerEl.createEl("button", {
      text: "入力",
      cls: "nn-glossary-insert-btn",
    });
    this.insertBtn.addEventListener("mousedown", e => {
      e.preventDefault();
      e.stopPropagation();
      this.confirmSelection();
    });
  }

  /** 検索入力欄にフォーカスを移す（開いた直後に呼ぶ） */
  focusInput(): void {
    // トリガー文字（"/"等）を入力した直後にフォーカスを移す際、
    // ブラウザ側の文字入力処理とタイミングが重なり、その文字自体が
    // 検索欄に紛れ込むことがある（実機で確認済み）。フォーカス時点の
    // クリアだけでは間に合わないことがあるため、短い猶予期間を設け、
    // その間に発生した input イベントは（inputハンドラ側で）
    // 確実に無視・クリアする。
    this.ignoreInputUntil = Date.now() + 200;
    this.searchInputEl.focus();
    this.searchInputEl.value = "";
  }

  // ─────────────────────────────────────────
  // 外部からの入力（CM6側から呼ばれる）
  // ─────────────────────────────────────────

  /** トリガー文字以降に入力された文字列（検索クエリ）を反映する */
  setQuery(query: string): void {
    this.query = query;
    this.selectedIndex = 0;
    this.render();
  }

  moveSelection(delta: number): void {
    if (this.rows.length === 0) return;
    this.selectedIndex = Math.min(
      Math.max(this.selectedIndex + delta, 0),
      this.rows.length - 1
    );
    this.renderList();
  }

  /** → キー、または非leaf行でのEnter/クリック */
  navigateInto(): void {
    const row = this.rows[this.selectedIndex];
    if (row?.navigate) row.navigate();
  }

  /** ← キー */
  navigateBack(): void {
    // 検索中（クエリが入っている状態）は階層移動の概念がないため何もしない。
    // クエリを削除すれば元の階層表示に自然に戻る。
    if (this.query.trim().length > 0) return;
    if (this.path.length <= 1) return;
    this.path.pop();
    this.selectedIndex = 0;
    this.render();
  }

  /**
   * Enter キー、または入力ボタン。
   *
   * 常に選択中の行の insertText をそのまま入力する。
   * 以前は「非leaf行なら代わりに階層移動する」というフォールバックが
   * あったが、これだと「フォルダ名そのものを文字として入力したい」
   * という操作ができず、かつ「入力ボタンで階層移動してしまう」という
   * 分かりにくい挙動になっていたため廃止した。階層移動は行の
   * クリック、または →キー（navigateInto）でのみ行う。
   */
  confirmSelection(): void {
    const row = this.rows[this.selectedIndex];
    if (!row || row.disabled) return;
    this.callbacks.onInsert(row.insertText, row.filePath ?? "");
  }

  destroy(): void {
    // DOM 自体は呼び出し元（editor/glossaryPalette.ts）が
    // ポップアップ要素ごと破棄するため、ここでは特別な後始末は不要。
  }

  /**
   * パレット全体に許容される高さ（px）を渡し、ヘッダー・フッターの
   * 実測高さを差し引いた残りをリスト部分の高さ上限として設定する。
   * flexboxの縮小計算に任せきりにせず明示的に計算することで、
   * 用語数が多い場合でも入力ボタン（フッター）が必ず見える範囲に
   * 収まるようにする（モバイルでソフトキーボードにより
   * 表示領域が狭い場合の対策）。
   */
  setListMaxHeight(totalHeightPx: number): void {
    const headerH = this.headerEl.getBoundingClientRect().height;
    const footerH = this.footerEl.getBoundingClientRect().height;
    const listMax = Math.max(60, totalHeightPx - headerH - footerH - 4);
    // 静的スタイル代入は obsidianmd/no-static-styles-assignment に抵触するため、
    // setCssStyles を使用する（コミュニティプラグイン審査対応）。
    this.listEl.setCssStyles({ maxHeight: `${listMax}px` });
  }

  // ─────────────────────────────────────────
  // 階層移動
  // ─────────────────────────────────────────
  private push(segment: PathSegment): void {
    this.path.push(segment);
    this.selectedIndex = 0;
    this.render();
  }

  private currentSegment(): PathSegment {
    return this.path[this.path.length - 1];
  }

  // ─────────────────────────────────────────
  // 行の生成
  // ─────────────────────────────────────────
  private row(icon: string, label: string, navigate: () => void): Row {
    return { icon, label, insertText: label, navigate };
  }

  private emptyRow(label: string): Row {
    return { icon: "…", label, insertText: "", disabled: true };
  }

  private termFileRow(term: TermEntry): Row {
    const candidates = this.notationCandidates(term);
    if (candidates.length === 1) {
      // 表記候補が「ファイル名」1つしかない場合、わざわざもう一段階
      // 「表記選択」画面へ移動させると同じ名前が二重に表示されて
      // 紛らわしいだけなので、その場でリーフ行として扱い、
      // 直接入力できるようにする（階層を1段飛ばす）。
      const only = candidates[0];
      return {
        icon: only.icon,
        label: only.label,
        insertText: only.label,
        filePath: term.filePath,
      };
    }
    // 表記候補が複数ある場合：クリックすれば表記選択画面へ進むが、
    // Enter／入力ボタンでその場で直接確定することもできる
    // （confirmSelection() は navigate の有無にかかわらず常に
    //  insertText をそのまま入力する設計のため）。その場合に
    // 履歴が記録されるよう、filePath も必ず設定しておく
    // （これが無いと「フォルダ直下の用語ファイル行から直接入力した
    //   場合だけ最近使ったに記録されない」という不具合になる）。
    // このレベル（カテゴリ／フォルダ直下の一覧、および「最近使った」）は
    // 「用語ファイルそのもの」を表す行なので、アイコン（📄）と表示文字列を
    // 一致させるため、常に実際のファイル名を表示する。name を優先して
    // 表示すると、アイコンは📄（ファイル）なのに文字列は name というズレが
    // 生じ、「nameがファイル名として表示されている」という混乱を招くため。
    // ファイル名／name／aliases の使い分けは、この行から一段階進んだ
    // 表記選択画面（"term"）で行う。
    const fileName = fileBaseName(term.filePath);
    return {
      icon: "📄",
      label: fileName,
      insertText: fileName,
      filePath: term.filePath,
      navigate: () => this.push({ kind: "term", term }),
    };
  }

  /**
   * 用語ファイル1件から「表記候補」（ファイル名／name／aliases）を組み立てる。
   * name がファイル名と同じ場合は🪪行を省略する（重複表示回避）。
   */
  private notationCandidates(term: TermEntry): { icon: string; label: string }[] {
    const base = fileBaseName(term.filePath);
    const list: { icon: string; label: string }[] = [{ icon: "📄", label: base }];
    if (term.name && term.name !== base) {
      list.push({ icon: "🪪", label: term.name });
    }
    for (const alias of term.aliases) {
      if (alias) list.push({ icon: "🏷", label: alias });
    }
    return list;
  }

  private computeSearchRows(query: string): Row[] {
    // 用語（用語ファイル）ごとにグループ化する。
    // グループ内の表記順は notationCandidates() の並び
    // （ファイル名 → name → aliases）をそのまま維持し、
    // グループ自体（＝用語ごとの並び）だけをA-Z順（日本語ロケール
    // 考慮）にソートする。表記の文字列だけで単純にソートすると、
    // 同じ用語内でも他の用語の表記と混ざり合ってしまい、
    // 「ファイル名→name→aliases」の順序が崩れてしまうため。
    const groups: { sortKey: string; term: TermEntry; matched: { icon: string; label: string }[] }[] = [];
    for (const term of this.allTerms) {
      const matched = this.notationCandidates(term).filter(c => c.label.includes(query));
      if (matched.length > 0) {
        groups.push({
          sortKey: term.name || fileBaseName(term.filePath),
          term,
          matched,
        });
      }
    }
    groups.sort((a, b) => a.sortKey.localeCompare(b.sortKey, "ja"));

    const rows: Row[] = [];
    for (const { term, matched } of groups) {
      for (const c of matched) {
        rows.push({
          icon: c.icon,
          label: c.label,
          insertText: c.label,
          filePath: term.filePath,
        });
      }
    }

    if (rows.length === 0) rows.push(this.emptyRow("一致する用語がありません"));
    return rows;
  }

  private computeRowsForSegment(segment: PathSegment): Row[] {
    switch (segment.kind) {
      case "root":
        return [
          this.row("🕒", "最近使った", () => this.push({ kind: "recent" })),
          this.row("📂", "カテゴリ", () => this.push({ kind: "category-list" })),
          this.row("🔍", "すべて", () => this.push({ kind: "all" })),
        ];

      case "recent": {
        const terms = this.recentFilePaths
          .map(fp => this.allTerms.find(t => t.filePath === fp))
          .filter((t): t is TermEntry => !!t);
        if (terms.length === 0) return [this.emptyRow("最近使った用語はありません")];
        return terms.map(t => this.termFileRow(t));
      }

      case "category-list": {
        if (this.categories.length === 0) return [this.emptyRow("用語が登録されていません")];
        return this.categories.map(cat =>
          this.row(iconForTag(cat.tag), cat.label, () => this.push({ kind: "category", node: cat }))
        );
      }

      case "all":
        // クエリが空でも computeSearchRows に渡す。
        // 空文字列はどの文字列にも「含まれる」ため、結果として
        // 全用語・全表記が表示される（＝「全てを表示して、文字で
        // 絞り込む」という仕様通りの挙動になる）。
        return this.computeSearchRows(this.query.trim());

      case "category": {
        const rows: Row[] = [];
        for (const child of segment.node.tree.children) {
          rows.push(
            this.row("📁", child.name, () =>
              this.push({ kind: "folder", node: child, categoryNode: segment.node })
            )
          );
        }
        for (const term of segment.node.tree.terms) rows.push(this.termFileRow(term));
        if (rows.length === 0) return [this.emptyRow("このカテゴリに用語がありません")];
        return rows;
      }

      case "folder": {
        const rows: Row[] = [];
        for (const child of segment.node.children) {
          rows.push(
            this.row("📁", child.name, () =>
              this.push({ kind: "folder", node: child, categoryNode: segment.categoryNode })
            )
          );
        }
        for (const term of segment.node.terms) rows.push(this.termFileRow(term));
        if (rows.length === 0) return [this.emptyRow("このフォルダに用語がありません")];
        return rows;
      }

      case "term":
        return this.notationCandidates(segment.term).map(c => ({
          icon: c.icon,
          label: c.label,
          insertText: c.label,
          filePath: segment.term.filePath,
        }));
    }
  }

  // ─────────────────────────────────────────
  // 描画
  // ─────────────────────────────────────────
  private render(): void {
    this.rows =
      this.query.trim().length > 0
        ? this.computeSearchRows(this.query.trim())
        : this.computeRowsForSegment(this.currentSegment());

    if (this.selectedIndex >= this.rows.length) {
      this.selectedIndex = Math.max(0, this.rows.length - 1);
    }

    this.renderBreadcrumb();
    this.renderList();
  }

  private labelFor(segment: PathSegment): string {
    switch (segment.kind) {
      case "root": return "用語入力パレット";
      case "recent": return "🕒 最近使った";
      case "category-list": return "📂 カテゴリ";
      case "all": return "🔍 すべて（入力して絞り込み）";
      case "category": return `${iconForTag(segment.node.tag)} ${segment.node.label}`;
      case "folder": return `📁 ${segment.node.name}`;
      case "term": return `📄 ${fileBaseName(segment.term.filePath)}`;
    }
  }

  private renderBreadcrumb(): void {
    this.breadcrumbEl.empty();

    const isSearching = this.query.trim().length > 0;

    if (isSearching) {
      this.breadcrumbEl.createSpan({
        text: `🔍 ${this.query.trim()}`,
        cls: "nn-glossary-crumb",
      });
    } else {
      this.path.forEach((segment, i) => {
        if (i > 0) {
          this.breadcrumbEl.createSpan({ text: " › ", cls: "nn-glossary-crumb-sep" });
        }
        const crumb = this.breadcrumbEl.createSpan({
          text: this.labelFor(segment),
          cls: "nn-glossary-crumb",
        });
        if (i < this.path.length - 1) {
          crumb.addClass("is-clickable");
          crumb.addEventListener("mousedown", e => {
            e.preventDefault();
            e.stopPropagation();
            this.path = this.path.slice(0, i + 1);
            this.selectedIndex = 0;
            this.render();
          });
        }
      });
    }

    // 「戻る」ボタンは、検索中でなく、かつルート以外にいる時だけ有効
    const canGoBack = !isSearching && this.path.length > 1;
    this.backBtn.toggleClass("is-disabled", !canGoBack);
    this.backBtn.disabled = !canGoBack;
  }

  private renderList(): void {
    this.listEl.empty();

    this.rows.forEach((row, i) => {
      const rowEl = this.listEl.createDiv({
        cls:
          "nn-glossary-row" +
          (i === this.selectedIndex ? " is-selected" : "") +
          (row.disabled ? " is-disabled" : ""),
      });
      rowEl.createSpan({ text: row.icon, cls: "nn-glossary-row-icon" });
      rowEl.createSpan({ text: row.label, cls: "nn-glossary-row-label" });
      if (row.navigate) rowEl.createSpan({ text: "›", cls: "nn-glossary-row-arrow" });

      if (row.disabled) return;

      rowEl.addEventListener("mousedown", e => {
        e.preventDefault();
        e.stopPropagation();
        this.selectedIndex = i;
        if (row.navigate) {
          // 非leaf行はクリック＝即座に階層移動（曖昧さがないため）
          row.navigate();
          return;
        }

        // leaf行（表記）はタップ／クリック＝選択のみ。
        // 入力は入力ボタン／Enterで確定する
        // （誤タップでの誤入力を防ぐという仕様書通りの挙動。
        //  モバイルでの入力ボタンの可視性問題は別途対処する）。
        this.renderList();
      });
    });

    const selectedEl = this.listEl.children[this.selectedIndex] as HTMLElement | undefined;
    selectedEl?.scrollIntoView({ block: "nearest" });

    // 入力ボタンは「leaf行が選択されている時」だけ有効化する
    const selectedRow = this.rows[this.selectedIndex];
    const canInsert = !!selectedRow && !selectedRow.disabled;
    this.insertBtn.disabled = !canInsert;
  }
}
