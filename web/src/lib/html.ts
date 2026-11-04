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

export function htmlDocument(source: string): string {
  const trimmed = source.trim();
  if (/^<!doctype/i.test(trimmed) || /<html[\s>]/i.test(trimmed)) {
    return source;
  }
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { color-scheme: light; }
  body { margin: 0; padding: 16px; font: 15px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; color: #18181b; background: #fff; }
  img { max-width: 100%; }
  table { border-collapse: collapse; }
  th, td { border: 1px solid #d4d4d8; padding: 6px 10px; text-align: left; }
</style>
</head>
<body>${source}</body>
</html>`;
}
