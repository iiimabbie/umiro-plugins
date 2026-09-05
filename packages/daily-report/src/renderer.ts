import type { DailyReport, ReportItem, ReportLevel } from "./types.js";

const ESC = "\u001b";
const RESET = `${ESC}[0m`;
const MAX_OUTPUT_LENGTH = 3_800;

const SECTION_ICON: Record<string, string> = {
  "今日天氣": "☀️",
  "今日行程": "📅",
  "重要信件": "✉️",
  "提醒事項": "☝🏻",
  "近期行程": "🚶🏻‍♀️",
  "今日小結": "💬",
};

const STYLE: Record<ReportLevel, string> = {
  normal: `${ESC}[1;37m`,
  positive: `${ESC}[1;32m`,
  warning: `${ESC}[1;33m`,
  critical: `${ESC}[1;31m`,
  muted: `${ESC}[0;37m`,
  special: `${ESC}[1;35m`,
};

const SYMBOL: Record<ReportLevel, string> = {
  normal: "●",
  positive: "●",
  warning: "▲",
  critical: "!",
  muted: "·",
  special: "◆",
};

function cleanText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replaceAll(ESC, "")
    .replace(/```/g, "'''")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, maxLength);
}

function sectionHeading(title: string): string {
  const normalizedTitle = title.replace(/^\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?\p{Emoji_Modifier}?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?\p{Emoji_Modifier}?)*\s*/u, "");
  const icon = SECTION_ICON[normalizedTitle] ?? "📌";
  return `${ESC}[1;36m${icon} ${normalizedTitle} ━━━━━━━━━━━━━━━${RESET}`;
}

function itemLine(item: ReportItem): string {
  const level: ReportLevel = item.level ?? "normal";
  const text = cleanText(item.text, 260);
  if (!text) return "";
  const label = cleanText(item.label, 24);
  const prefix = label ? `${SYMBOL[level]} ${label}` : SYMBOL[level];
  return `${STYLE[level]}${prefix}${RESET} ${text}`;
}

export function validateReport(value: unknown): DailyReport {
  if (!value || typeof value !== "object") throw new Error("report must be an object");
  const input = value as Partial<DailyReport>;
  const date_key = cleanText(input.date_key, 10);
  const date = cleanText(input.date, 40);
  const headline = cleanText(input.headline, 280);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date_key)) throw new Error("date_key must use YYYY-MM-DD");
  if (!date) throw new Error("date is required");
  if (!headline) throw new Error("headline is required");
  if (!Array.isArray(input.sections) || input.sections.length === 0) throw new Error("at least one section is required");

  const sections = input.sections.slice(0, 8).map((section, sectionIndex) => {
    if (!section || typeof section !== "object") throw new Error(`section ${sectionIndex + 1} is invalid`);
    const title = cleanText(section.title, 40);
    if (!title) throw new Error(`section ${sectionIndex + 1} title is required`);
    if (!Array.isArray(section.items)) throw new Error(`section ${sectionIndex + 1} items must be an array`);
    const items = section.items.slice(0, 8).map((item, itemIndex) => {
      if (!item || typeof item !== "object") throw new Error(`section ${sectionIndex + 1} item ${itemIndex + 1} is invalid`);
      const text = cleanText(item.text, 260);
      if (!text) throw new Error(`section ${sectionIndex + 1} item ${itemIndex + 1} text is required`);
      const level = item.level ?? "normal";
      if (!Object.hasOwn(STYLE, level)) throw new Error(`unsupported report level: ${String(level)}`);
      return { text, level, ...(item.label ? { label: cleanText(item.label, 24) } : {}) };
    });
    return { title, items };
  });

  return { date_key, date, headline, sections };
}

export function renderDailyReport(value: unknown): string {
  const report = validateReport(value);
  const lines: string[] = [];

  for (const section of report.sections) {
    if (section.items.length === 0) continue;
    if (lines.length > 0) lines.push("");
    lines.push(sectionHeading(section.title));
    for (const item of section.items) {
      const line = itemLine(item);
      if (line) lines.push(line);
    }
  }

  const body = lines.join("\n");
  let output = `# 📰 每日簡報\n**${report.date}**\n${report.headline}\n\n\`\`\`ansi\n${body}\n\`\`\``;
  if (output.length <= MAX_OUTPUT_LENGTH) return output;

  const suffix = `\n${STYLE.muted}· 內容過長，已省略較後項目${RESET}\n\`\`\``;
  const prefixLength = output.indexOf("```ansi\n") + "```ansi\n".length;
  const room = MAX_OUTPUT_LENGTH - prefixLength - suffix.length;
  output = `${output.slice(0, prefixLength)}${body.slice(0, Math.max(0, room)).replace(/[^\n]*$/, "")}${suffix}`;
  return output;
}
