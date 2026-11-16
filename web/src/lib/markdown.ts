const DOCUMENT_WIDE = /^ {0,3}(?:\[[^\]\n]+\]:|\[\^|<[A-Za-z!/])/m;
const CONTINUATION = /^(?:[ \t]|(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$))/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

export function splitMarkdownBlocks(text: string): string[] | null {
  if (!text.includes("\n\n") || DOCUMENT_WIDE.test(text)) return null;
  const blocks: string[] = [];
  let blockStart = 0;
  let lineStart = 0;
  let fence: string | null = null;
  let indent = 0;
  let afterBlank = false;
  for (const line of text.split("\n")) {
    const opener = FENCE.exec(line)?.[1] ?? null;
    if (fence !== null) {
      if (/\S/.test(line.slice(0, indent))) return null;
      if (opener && opener[0] === fence[0] && opener.length >= fence.length && line.trim() === opener) {
        fence = null;
      }
    } else if (line.trim() === "") {
      afterBlank = true;
    } else {
      if (afterBlank && lineStart > blockStart && !CONTINUATION.test(line)) {
        blocks.push(text.slice(blockStart, lineStart));
        blockStart = lineStart;
      }
      afterBlank = false;
      fence = opener;
      if (fence) indent = line.indexOf(fence);
    }
    lineStart += line.length + 1;
  }
  blocks.push(text.slice(blockStart));
  return blocks.length > 1 ? blocks : null;
}
