import type { LineRange } from "./types";

export type Point = { node: Node; offset: number };

const WORD_CHAR = /[\p{L}\p{N}]/u;
const CONNECTOR = /[-'’]/;

function seedWord(text: string, at: number): [number, number] {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
    for (const part of segmenter.segment(text)) {
      const end = part.index + part.segment.length;
      if (part.isWordLike && at > part.index && at <= end) return [part.index, end];
    }
  }
  let start = at;
  let end = at;
  while (start > 0 && WORD_CHAR.test(text[start - 1])) start--;
  while (end < text.length && WORD_CHAR.test(text[end])) end++;
  if (start === end) {
    start = Math.min(at, text.length - 1);
    end = start + 1;
  }
  return [start, end];
}

export function wordBounds(text: string, offset: number): [number, number] {
  const at = Math.max(0, Math.min(offset, text.length));
  if (!text) return [0, 0];
  let [start, end] = seedWord(text, at);
  while (start > 1 && CONNECTOR.test(text[start - 1]) && WORD_CHAR.test(text[start - 2])) {
    start--;
    while (start > 0 && WORD_CHAR.test(text[start - 1])) start--;
  }
  while (end < text.length - 1 && CONNECTOR.test(text[end]) && WORD_CHAR.test(text[end + 1])) {
    end++;
    while (end < text.length && WORD_CHAR.test(text[end])) end++;
  }
  return [start, end];
}

export function caretAt(x: number, y: number): Point | null {
  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  const range = doc.caretRangeFromPoint?.(x, y);
  if (range) return { node: range.startContainer, offset: range.startOffset };
  const position = doc.caretPositionFromPoint?.(x, y);
  return position ? { node: position.offsetNode, offset: position.offset } : null;
}

function textPoint(point: Point | null): Point | null {
  if (!point) return null;
  if (point.node.nodeType === Node.TEXT_NODE) return point;
  const text = point.node.firstChild;
  return text?.nodeType === Node.TEXT_NODE ? { node: text, offset: 0 } : null;
}

export function wordAt(x: number, y: number): { range: Range; from: Point; to: Point } | null {
  const point = textPoint(caretAt(x, y));
  if (!point) return null;
  const [start, end] = wordBounds(point.node.textContent ?? "", point.offset);
  const range = document.createRange();
  try {
    range.setStart(point.node, start);
    range.setEnd(point.node, end);
  } catch {
    return null;
  }
  if (range.collapsed) return null;
  return { range, from: { node: point.node, offset: start }, to: { node: point.node, offset: end } };
}

export function comparePoints(a: Point, b: Point): number {
  const probe = document.createRange();
  try {
    probe.setStart(a.node, a.offset);
    probe.collapse(true);
  } catch {
    return 0;
  }
  return probe.comparePoint(b.node, b.offset);
}

export function rangeBetween(a: Point, b: Point): Range | null {
  const [from, to] = comparePoints(a, b) >= 0 ? [a, b] : [b, a];
  const range = document.createRange();
  try {
    range.setStart(from.node, from.offset);
    range.setEnd(to.node, to.offset);
  } catch {
    return null;
  }
  return range.collapsed ? null : range;
}

export function selectionFile(node: Node | null): {
  path: string;
  href: string;
  lines?: LineRange[];
} | undefined {
  const element = node instanceof Element ? node : node?.parentElement;
  const anchor = element?.closest<HTMLAnchorElement>("a[data-pero-href]");
  const path = anchor?.dataset.filePath;
  const href = anchor?.dataset.peroHref;
  if (!path || !href) return undefined;
  let lines: LineRange[] | undefined;
  try {
    const raw = anchor?.dataset.fileLines;
    lines = raw ? (JSON.parse(raw) as LineRange[]) : undefined;
  } catch {
    lines = undefined;
  }
  return { path, href, lines };
}

export type Box = { left: number; top: number; width: number; height: number };

export function boxesOf(range: Range): Box[] {
  const boxes: Box[] = [];
  for (const rect of range.getClientRects()) {
    if (rect.width < 1 || rect.height < 1) continue;
    boxes.push({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
  }
  return boxes;
}
