export type LineStatus = "running" | "ok" | "err";
export interface ActivityLine { readonly kind: "tool"; readonly operationId: string; readonly tool: string; status: LineStatus }

const ICON: Record<LineStatus, string> = { running: "→", ok: "✓", err: "✗" };

export function renderLine(line: ActivityLine): string {
  return `${ICON[line.status]} ${line.tool}`;
}

/** Joins the lines newest-last and keeps the tail when the cap is exceeded. */
export function renderActivity(lines: readonly ActivityLine[], maxCharacters: number): string {
  if (!lines.length) return "…";
  const rendered = lines.map(renderLine);
  let start = 0; let length = rendered.reduce((total, text) => total + text.length, 0) + rendered.length - 1;
  while (start < rendered.length - 1 && length > maxCharacters) { length -= rendered[start]!.length + 1; start++; }
  const tail = rendered.slice(start).join("\n");
  return tail.length > maxCharacters ? tail.slice(tail.length - maxCharacters) : tail;
}
