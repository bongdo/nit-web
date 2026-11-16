const FENCED = /```[\s\S]*?```/g;
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

export type HtmlArtifact = {
  path: string;
  title: string;
};

export type HtmlArtifactSegment = {
  text: string;
  artifacts: HtmlArtifact[];
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

export function htmlArtifactSegments(text: string): HtmlArtifactSegment[] {
  if (!text.includes("[[html:")) return [{ text, artifacts: [] }];
  const safe = blankCode(text);
  const segments: HtmlArtifactSegment[] = [];
  let cursor = 0;
  for (const match of safe.matchAll(HTML_ARTIFACT)) {
    const path = match[1].trim().replace(/^\.\/+/, "");
    if (!isHtmlArtifactPath(path)) continue;
    const start = match.index ?? 0;
    segments.push({ text: text.slice(cursor, start), artifacts: [] });
    segments.push({
      text: "",
      artifacts: [{ path, title: (match[2] ?? "").trim() }],
    });
    cursor = start + match[0].length;
  }
  if (segments.length === 0) return [{ text, artifacts: [] }];
  segments.push({ text: text.slice(cursor), artifacts: [] });
  return segments;
}

export function stripHtmlArtifacts(text: string): string {
  if (!text.includes("[[html:")) return text;
  return htmlArtifactSegments(text)
    .map((segment) => segment.text)
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}


export function htmlDocument(
  source: string,
  dark = false,
  background = dark ? "#0c0e12" : "#fbfbfc",
): string {
  const trimmed = source.trim();
  if (/^<!doctype/i.test(trimmed) || /<html[\s>]/i.test(trimmed)) {
    return source;
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
