const FENCED = /(`{3,}|~{3,})[\s\S]*?\1/g;
const INLINE = /`[^`\n]+`/g;

export function withoutCode(text: string): string {
  return text.replace(FENCED, " ").replace(INLINE, " ");
}

const HTML_TAG =
  /<!doctype\s+html|<html[\s>]|<(?:h[1-6]|p|div|table|thead|tbody|tr|td|th|ul|ol|li|section|article|header|footer|main|nav|form|button|style|svg|canvas|video|audio|iframe|figure|details|dialog)\b/i;

export function looksLikeHtml(text: string): boolean {
  if (!text.trim()) return false;
  return HTML_TAG.test(withoutCode(text));
}

export function isPureHtml(text: string): boolean {
  const trimmed = text.trim();
  if (!looksLikeHtml(trimmed)) return false;
  return /^<(?!!--)(?:!doctype\s+html|html[\s>]|[a-z][\w-]*[\s>/])/i.test(trimmed);
}

export function isHtmlLanguage(lang?: string): boolean {
  if (!lang) return false;
  const value = lang.toLowerCase();
  return value === "html" || value === "htm" || value === "xhtml";
}

export function previewableHtml(code: string, language?: string): boolean {
  if (language) return isHtmlLanguage(language);
  return isPureHtml(code);
}

export type HtmlArtifact =
  | { path: string; title: string }
  | { source: string };

export type HtmlArtifactSegment = {
  text: string;
  artifacts: HtmlArtifact[];
};

type HtmlInsert = {
  start: number;
  end: number;
  artifact: HtmlArtifact;
};

const HTML_ARTIFACT =
  /^[ \t]*\[\[html:([^\]|\r\n]+?)(?:\|([^\]\r\n]*))?\]\][ \t]*$/gm;

function blankCode(text: string): string {
  return text
    .replace(FENCED, (match) => " ".repeat(match.length))
    .replace(INLINE, (match) => " ".repeat(match.length));
}

export function isHtmlArtifactPath(path: string): boolean {
  if (!path || path.length > 300) return false;
  if (path.startsWith("/") || path.includes("\\") || path.includes("\0")) return false;
  if (!/^[A-Za-z0-9._/-]+$/.test(path)) return false;
  if (!/\.html?$/i.test(path)) return false;
  return !path.split("/").some((part) => part === "" || part === "." || part === "..");
}

function markerInserts(text: string): HtmlInsert[] {
  if (!text.includes("[[html:")) return [];
  const safe = blankCode(text);
  const inserts: HtmlInsert[] = [];
  for (const match of safe.matchAll(HTML_ARTIFACT)) {
    const path = match[1].trim().replace(/^\.\/+/, "");
    if (!isHtmlArtifactPath(path)) continue;
    const start = match.index ?? 0;
    inserts.push({
      start,
      end: start + match[0].length,
      artifact: { path, title: (match[2] ?? "").trim() },
    });
  }
  return inserts;
}

function fenceInserts(text: string): HtmlInsert[] {
  const inserts: HtmlInsert[] = [];
  let open:
    | { char: string; length: number; language: string; start: number; body: number }
    | null = null;
  let offset = 0;
  for (const line of text.split("\n")) {
    if (open) {
      const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
      if (close && close[1][0] === open.char && close[1].length >= open.length) {
        const body = text.slice(open.body, offset).replace(/\n$/, "");
        if (isHtmlLanguage(open.language) || (!open.language && isPureHtml(body))) {
          inserts.push({
            start: open.start,
            end: offset + line.length,
            artifact: { source: body },
          });
        }
        open = null;
      }
    } else {
      const start = /^ {0,3}(`{3,}|~{3,})([^\n]*)$/.exec(line);
      if (start) {
        open = {
          char: start[1][0],
          length: start[1].length,
          language: (start[2].trim().split(/\s+/)[0] ?? "").toLowerCase(),
          start: offset,
          body: offset + line.length + 1,
        };
      }
    }
    offset += line.length + 1;
  }
  return inserts;
}

function segmentsFrom(text: string, inserts: HtmlInsert[]): HtmlArtifactSegment[] {
  const segments: HtmlArtifactSegment[] = [];
  let cursor = 0;
  for (const insert of inserts) {
    if (insert.start < cursor) continue;
    segments.push({ text: text.slice(cursor, insert.start), artifacts: [] });
    segments.push({ text: "", artifacts: [insert.artifact] });
    cursor = insert.end;
  }
  segments.push({ text: text.slice(cursor), artifacts: [] });
  return segments;
}

export function htmlArtifactSegments(text: string): HtmlArtifactSegment[] {
  if (!text.includes("[[html:") && isPureHtml(text)) {
    return [{ text: "", artifacts: [{ source: text }] }];
  }
  const inserts = [...markerInserts(text), ...fenceInserts(text)].sort(
    (left, right) => left.start - right.start,
  );
  if (inserts.length === 0) return [{ text, artifacts: [] }];
  return segmentsFrom(text, inserts);
}

export function stripHtmlArtifacts(text: string): string {
  const inserts = markerInserts(text);
  if (inserts.length === 0) return text;
  return segmentsFrom(text, inserts)
    .map((segment) => segment.text)
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}



function previewTheme(dark: boolean): string {
  const foreground = dark ? "#e4e4e7" : "#18181b";
  return `<style id="nit-preview-theme">
html { color-scheme: ${dark ? "dark" : "light"}; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
html, body { background: transparent; color: ${foreground}; }
</style>`;
}

function withPreviewTheme(source: string, style: string): string {
  const head = /<head(?:\s[^>]*)?>/i.exec(source);
  if (head) {
    const at = head.index + head[0].length;
    return source.slice(0, at) + style + source.slice(at);
  }
  const root = /<html(?:\s[^>]*)?>/i.exec(source);
  if (root) {
    const at = root.index + root[0].length;
    return `${source.slice(0, at)}<head>${style}</head>${source.slice(at)}`;
  }
  const doctype = /^\s*<!doctype[^>]*>/i.exec(source);
  if (doctype) {
    const at = doctype[0].length;
    return `${source.slice(0, at)}<head>${style}</head>${source.slice(at)}`;
  }
  return style + source;
}

export function htmlDocument(
  source: string,
  dark = false,
  background = dark ? "#0c0e12" : "#fbfbfc",
): string {
  const trimmed = source.trim();
  if (/^<!doctype/i.test(trimmed) || /<html[\s>]/i.test(trimmed)) {
    return withPreviewTheme(source, previewTheme(dark));
  }
  const foreground = dark ? "#e4e4e7" : "#18181b";
  const border = dark ? "#3f3f46" : "#d4d4d8";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  html, body { background: ${background}; }
  body { margin: 0; padding: 16px; font: 15px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; color: ${foreground}; }
  input, button, select, textarea { color: inherit; font: inherit; }
  img { max-width: 100%; }
  table { border-collapse: collapse; }
  th, td { border: 1px solid ${border}; padding: 6px 10px; text-align: left; }
</style>
</head>
<body>${source}</body>
</html>`;
}
