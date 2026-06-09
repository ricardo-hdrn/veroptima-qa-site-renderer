/** Minimal HTML escaper for renderer content. Never deserializes user input back into HTML — escape always; trust no source artifact text. */
const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
const ESCAPE_RE = /[&<>"']/g;

export function esc(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return s.replace(ESCAPE_RE, (c) => ESCAPES[c] ?? c);
}

/** Render a string array as one-per-line `<li>` items, escaped. */
export function escList(items: ReadonlyArray<unknown>): string {
  return items.map((it) => `<li>${esc(it)}</li>`).join("\n");
}
