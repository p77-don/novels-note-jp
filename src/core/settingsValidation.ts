// ─────────────────────────────────────────
// Novels Note JP — 保存設定の検証・補正
//
// loadData() で読み込んだ保存データは、
//   - 手編集された data.json
//   - 同期の途中で部分的にしか反映されていないデータ
//   - 旧バージョンの古い形式のデータ
// である可能性があり、型・範囲が保証されていない。
// 従来は Object.assign({}, DEFAULT_SETTINGS, saved) によるトップレベルの
// 浅いマージのみで、フィールドごとの型検証を行っていなかったため、
// 不正な値がそのまま UI やCSS生成、正規表現処理に渡り、
// 実行時エラーへ連鎖するおそれがあった。
//
// ここでは各フィールドを型・範囲・列挙値まで検証し、
// 不正な値だけを個別にデフォルトへフォールバックさせる
// （正常なフィールドまでまとめて破棄しない）。
//
// 【スコープ】今回はスキーマバージョンの保存・段階的マイグレーションは
// 見送り、読み込み時の検証強化のみを行う（実害である「undefinedによる
// 実行時エラー」を防ぐことを主目的とする）。
// ─────────────────────────────────────────

import {
  NovelsNoteSettings,
  DEFAULT_SETTINGS,
  DEFAULT_TAG_DEFINITIONS,
  DEFAULT_BRACKET_DEFINITIONS,
  TagDefinition,
  BracketDefinition,
  RubyStyle,
  FullWidthSpaceStyle,
  GlossaryPaletteScope,
  ManuscriptRulesFileRef,
} from "../settings";
import { sanitizeCssColor } from "./cssSafety";

/** 読み込み時に何らかの補正が発生したかどうかをまとめて呼び出し側へ伝える。 */
export interface SettingsValidationResult {
  settings: NovelsNoteSettings;
  /** 補正が発生したフィールド名（開発者コンソールでの調査用） */
  correctedFields: string[];
}

function isString(v: unknown): v is string {
  return typeof v === "string";
}
function isBoolean(v: unknown): v is boolean {
  return typeof v === "boolean";
}
function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}
function isOneOf<T extends string>(v: unknown, allowed: readonly T[]): v is T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v);
}

const RUBY_STYLES: readonly RubyStyle[] = ["narou", "aozora", "denden", "html"];
const FULL_WIDTH_SPACE_STYLES: readonly FullWidthSpaceStyle[] = ["dot", "underline", "box", "none"];
const GLOSSARY_PALETTE_SCOPES: readonly GlossaryPaletteScope[] = ["novelOnly", "novelAndGlossary", "all"];
const COUNT_MODES: readonly NovelsNoteSettings["countMode"][] = ["raw", "novel", "page"];
const RULER_STYLES: readonly NovelsNoteSettings["rulerStyle"][] = ["solid", "dashed"];

/**
 * 数値フィールドを検証する。範囲チェックはオプションで最小値のみ
 * （UI側で上限のあるスライダー等はUI側の制約に委ね、ここでは
 * 「NaN/Infinity/型違い/負の値」による実行時エラーの防止に限定する）。
 */
function validateNumber(
  value: unknown,
  fallback: number,
  fieldName: string,
  corrected: string[],
  min?: number
): number {
  if (isFiniteNumber(value) && (min === undefined || value >= min)) return value;
  corrected.push(fieldName);
  return fallback;
}

function validateBoolean(value: unknown, fallback: boolean, fieldName: string, corrected: string[]): boolean {
  if (isBoolean(value)) return value;
  corrected.push(fieldName);
  return fallback;
}

function validateEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
  fieldName: string,
  corrected: string[]
): T {
  if (isOneOf(value, allowed)) return value;
  corrected.push(fieldName);
  return fallback;
}

function validateColor(value: unknown, fallback: string, fieldName: string, corrected: string[]): string {
  if (isString(value)) {
    const sanitized = sanitizeCssColor(value, "");
    if (sanitized) return sanitized;
  }
  corrected.push(fieldName);
  return fallback;
}

function validateString(value: unknown, fallback: string, fieldName: string, corrected: string[]): string {
  if (isString(value)) return value;
  corrected.push(fieldName);
  return fallback;
}

/** 用語カテゴリ定義1件の検証。フィールド単位で個別に補正する。 */
function validateTagDefinition(
  value: unknown,
  fallback: TagDefinition,
  index: number,
  corrected: string[]
): TagDefinition {
  if (typeof value !== "object" || value === null) {
    corrected.push(`tagDefinitions[${index}]`);
    return { ...fallback };
  }
  const v = value as Partial<TagDefinition>;
  return {
    tag: validateString(v.tag, fallback.tag, `tagDefinitions[${index}].tag`, corrected),
    label: validateString(v.label, fallback.label, `tagDefinitions[${index}].label`, corrected),
    color: validateColor(v.color, fallback.color, `tagDefinitions[${index}].color`, corrected),
    enabled: validateBoolean(v.enabled, fallback.enabled, `tagDefinitions[${index}].enabled`, corrected),
  };
}

/** カッコ定義1件の検証。 */
function validateBracketDefinition(
  value: unknown,
  fallback: BracketDefinition,
  index: number,
  corrected: string[]
): BracketDefinition {
  if (typeof value !== "object" || value === null) {
    corrected.push(`bracketDefinitions[${index}]`);
    return { ...fallback };
  }
  const v = value as Partial<BracketDefinition>;
  return {
    id: validateString(v.id, fallback.id, `bracketDefinitions[${index}].id`, corrected),
    label: validateString(v.label, fallback.label, `bracketDefinitions[${index}].label`, corrected),
    open: validateString(v.open, fallback.open, `bracketDefinitions[${index}].open`, corrected),
    close: validateString(v.close, fallback.close, `bracketDefinitions[${index}].close`, corrected),
    color: validateColor(v.color, fallback.color, `bracketDefinitions[${index}].color`, corrected),
    enabled: validateBoolean(v.enabled, fallback.enabled, `bracketDefinitions[${index}].enabled`, corrected),
  };
}

/**
 * 配列フィールドを検証する。
 * - 配列でない場合はデフォルト配列（deep copy）にフォールバックする。
 * - 各要素は itemValidator に委譲し、要素単位で補正する
 *   （デフォルト側に対応する要素があればそれをフォールバックに使い、
 *   なければ空の要素は捨てる代わりに1件目のデフォルトを複製する）。
 */
function validateDefinitionArray<T>(
  value: unknown,
  defaults: readonly T[],
  fieldName: string,
  corrected: string[],
  itemValidator: (item: unknown, fallback: T, index: number, corrected: string[]) => T
): T[] {
  if (!Array.isArray(value)) {
    if (value !== undefined) corrected.push(fieldName);
    return defaults.map(d => ({ ...d }));
  }
  return value.map((item, i) => {
    const fallback = defaults[i] ?? defaults[0];
    return itemValidator(item, { ...fallback }, i, corrected);
  });
}

/** 文字列配列（除外フォルダなど）の検証。文字列以外の要素は除去する。 */
function validateStringArray(value: unknown, fieldName: string, corrected: string[]): string[] {
  if (!Array.isArray(value)) {
    if (value !== undefined) corrected.push(fieldName);
    return [];
  }
  const filtered = value.filter(isString);
  if (filtered.length !== value.length) corrected.push(fieldName);
  return filtered;
}

/** manuscriptRulesFiles（登録済み定義ファイル参照）の検証。 */
function validateManuscriptRulesFiles(value: unknown, corrected: string[]): ManuscriptRulesFileRef[] {
  if (!Array.isArray(value)) {
    if (value !== undefined) corrected.push("manuscriptRulesFiles");
    return [];
  }
  const result: ManuscriptRulesFileRef[] = [];
  for (let i = 0; i < value.length; i++) {
    const item = value[i];
    if (typeof item !== "object" || item === null || !isString((item as Partial<ManuscriptRulesFileRef>).fileName)) {
      corrected.push(`manuscriptRulesFiles[${i}]`);
      continue;
    }
    const v = item as Partial<ManuscriptRulesFileRef>;
    result.push({
      fileName: v.fileName as string,
      ...(isString(v.label) ? { label: v.label } : {}),
    });
  }
  return result;
}

/**
 * loadData() の戻り値（型不明の保存データ）を検証し、
 * 妥当な NovelsNoteSettings を組み立てる。
 */
export function validateAndSanitizeSettings(saved: unknown): SettingsValidationResult {
  const corrected: string[] = [];
  const s: Record<string, unknown> = typeof saved === "object" && saved !== null ? (saved as Record<string, unknown>) : {};

  const settings: NovelsNoteSettings = {
    wrapColumn: validateNumber(s.wrapColumn, DEFAULT_SETTINGS.wrapColumn, "wrapColumn", corrected, 1),
    showRuler: validateBoolean(s.showRuler, DEFAULT_SETTINGS.showRuler, "showRuler", corrected),
    rulerColor: validateColor(s.rulerColor, DEFAULT_SETTINGS.rulerColor, "rulerColor", corrected),
    rulerOpacity: validateNumber(s.rulerOpacity, DEFAULT_SETTINGS.rulerOpacity, "rulerOpacity", corrected, 0),
    rulerStyle: validateEnum(s.rulerStyle, RULER_STYLES, DEFAULT_SETTINGS.rulerStyle, "rulerStyle", corrected),
    fontSize: validateNumber(s.fontSize, DEFAULT_SETTINGS.fontSize, "fontSize", corrected, 1),
    lineHeight: validateNumber(s.lineHeight, DEFAULT_SETTINGS.lineHeight, "lineHeight", corrected, 0.1),
    highlightEnabled: validateBoolean(s.highlightEnabled, DEFAULT_SETTINGS.highlightEnabled, "highlightEnabled", corrected),
    tagDefinitions: validateDefinitionArray(
      s.tagDefinitions, DEFAULT_TAG_DEFINITIONS, "tagDefinitions", corrected, validateTagDefinition
    ),
    bracketDefinitions: validateDefinitionArray(
      s.bracketDefinitions, DEFAULT_BRACKET_DEFINITIONS, "bracketDefinitions", corrected, validateBracketDefinition
    ),

    termHoverPreviewEnabled: validateBoolean(
      s.termHoverPreviewEnabled, DEFAULT_SETTINGS.termHoverPreviewEnabled, "termHoverPreviewEnabled", corrected
    ),

    showFullWidthSpace: validateBoolean(s.showFullWidthSpace, DEFAULT_SETTINGS.showFullWidthSpace, "showFullWidthSpace", corrected),
    fullWidthSpaceStyle: validateEnum(
      s.fullWidthSpaceStyle, FULL_WIDTH_SPACE_STYLES, DEFAULT_SETTINGS.fullWidthSpaceStyle, "fullWidthSpaceStyle", corrected
    ),
    fullWidthSpaceColor: validateColor(s.fullWidthSpaceColor, DEFAULT_SETTINGS.fullWidthSpaceColor, "fullWidthSpaceColor", corrected),

    rubyStyle: validateEnum(s.rubyStyle, RUBY_STYLES, DEFAULT_SETTINGS.rubyStyle, "rubyStyle", corrected),

    countMode: validateEnum(s.countMode, COUNT_MODES, DEFAULT_SETTINGS.countMode, "countMode", corrected),
    countFullWidthSpace: validateBoolean(s.countFullWidthSpace, DEFAULT_SETTINGS.countFullWidthSpace, "countFullWidthSpace", corrected),
    countRubyText: validateBoolean(s.countRubyText, DEFAULT_SETTINGS.countRubyText, "countRubyText", corrected),
    pageLinesPerPage: validateNumber(s.pageLinesPerPage, DEFAULT_SETTINGS.pageLinesPerPage, "pageLinesPerPage", corrected, 1),

    verticalCursorHighlightColor: validateColor(
      s.verticalCursorHighlightColor, DEFAULT_SETTINGS.verticalCursorHighlightColor, "verticalCursorHighlightColor", corrected
    ),
    verticalCursorHighlightEnabled: validateBoolean(
      s.verticalCursorHighlightEnabled, DEFAULT_SETTINGS.verticalCursorHighlightEnabled, "verticalCursorHighlightEnabled", corrected
    ),

    excludeFolders: validateStringArray(s.excludeFolders, "excludeFolders", corrected),
    statsExcludeFolders: validateStringArray(s.statsExcludeFolders, "statsExcludeFolders", corrected),

    readingSpeedCharsPerMinute: validateNumber(
      s.readingSpeedCharsPerMinute, DEFAULT_SETTINGS.readingSpeedCharsPerMinute, "readingSpeedCharsPerMinute", corrected, 1
    ),

    glossaryPaletteEnabled: validateBoolean(
      s.glossaryPaletteEnabled, DEFAULT_SETTINGS.glossaryPaletteEnabled, "glossaryPaletteEnabled", corrected
    ),
    glossaryPaletteScope: validateEnum(
      s.glossaryPaletteScope, GLOSSARY_PALETTE_SCOPES, DEFAULT_SETTINGS.glossaryPaletteScope, "glossaryPaletteScope", corrected
    ),
    glossaryPaletteTrigger: validateString(
      s.glossaryPaletteTrigger, DEFAULT_SETTINGS.glossaryPaletteTrigger, "glossaryPaletteTrigger", corrected
    ),

    manuscriptRulesFiles: validateManuscriptRulesFiles(s.manuscriptRulesFiles, corrected),
    defaultManuscriptRulesFileName:
      s.defaultManuscriptRulesFileName === undefined
        ? undefined
        : isString(s.defaultManuscriptRulesFileName)
          ? s.defaultManuscriptRulesFileName
          : (corrected.push("defaultManuscriptRulesFileName"), undefined),
  };

  return { settings, correctedFields: corrected };
}
