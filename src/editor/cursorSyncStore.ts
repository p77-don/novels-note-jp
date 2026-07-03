// ─────────────────────────────────────────
// Novels Note JP — カーソル同期ストア
//
// 【これまでの問題】
// 縦書きプレビュー（VerticalPreviewView）は、Obsidian の
// MarkdownView.editor を外部から100msごとにポーリングして
// カーソル位置・選択範囲を取得し、それをもとにカーソル文の
// ハイライト・スクロール追従を行っていた。
//
// しかしこの方式では、日本語入力（IME）が変換中かどうかを
// 外部から判別する手段がなく、変換中の文字数変化のたびに
// 「カーソル位置が変わった」と誤検知してしまい、縦書き
// プレビューのハイライトが変換中も含めて頻繁に動いてしまう
// 問題があった。
//
// IME の変換状態（compositionstart / compositionend）は
// エディタの DOM に対して発火するイベントであり、これを正確に
// 検知できるのは CodeMirror 6 の Extension（extensions.ts）側だけ
// である。外部からのポーリングでは原理的に検知できない。
//
// 【設計】
// カーソル位置・選択範囲の「確定した」変化だけを、エディタ側
// （extensions.ts の buildCursorSyncExtension）が検知してこの
// ストアに書き込む。IME変換中は一切書き込まれない。
// 縦書きプレビューはこのストアを購読するだけになり、
// 「今IME変換中かどうか」を自分で判定する必要がなくなる。
// ─────────────────────────────────────────

import { TFile } from "obsidian";

export interface CursorSyncSnapshot {
  /** カーソルが存在するエディタが表示しているファイル */
  file: TFile | null;
  /** 0始まりの行番号 */
  line: number;
  /** 行内の文字位置（UTF-16コードユニット単位。CodeMirror/Obsidian editor と同じ基準） */
  ch: number;
  /** 選択中のテキスト（選択がなければ空文字列） */
  selection: string;
  /**
   * コミット時点のドキュメント全体の文字数（UTF-16コードユニット単位）。
   *
   * 縦書きプレビュー側が保持する「最後に描画した本文」の文字数と
   * 比較することで、まだ描画に反映されていない編集があるかどうかを
   * 直接判定できる。Obsidian の editor-change イベントは内部で
   * 間引かれることがあり、発火タイミングを信頼して「本文データが
   * 最新かどうか」を判定すると、CM6拡張側（毎回確実に発火する）の
   * カーソル通知より遅れてしまうことがあった。ドキュメント長の
   * 直接比較にすることで、イベント発火タイミングに一切依存しない
   * 判定にしている。
   */
  docLength: number;
}

const EMPTY_SNAPSHOT: CursorSyncSnapshot = { file: null, line: -1, ch: -1, selection: "", docLength: -1 };

export class CursorSyncStore {
  private snapshot: CursorSyncSnapshot = EMPTY_SNAPSHOT;
  private listeners = new Set<(snapshot: CursorSyncSnapshot) => void>();

  /** 現在の確定済みスナップショットを取得する */
  get(): CursorSyncSnapshot {
    return this.snapshot;
  }

  /**
   * 確定済みのカーソル位置・選択範囲を書き込み、購読者に通知する。
   * buildCursorSyncExtension() からのみ呼ばれることを想定している。
   */
  set(snapshot: CursorSyncSnapshot): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener(snapshot);
  }

  /**
   * スナップショットが更新されるたびに呼ばれるコールバックを登録する。
   * 戻り値の関数を呼ぶと購読解除できる。
   */
  subscribe(listener: (snapshot: CursorSyncSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
}
