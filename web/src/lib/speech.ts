import { useSyncExternalStore } from "react";
import { api, getInstance } from "./api";
import { appPath } from "./base";
import { splitMarkdownBlocks } from "./markdown";

export type SpeechPhase = "idle" | "loading" | "playing" | "paused";

export type SpeechState = {
  phase: SpeechPhase;
  message: string | null;
  block: number;
  rate: number;
  anchored: boolean;
};

export type SpeechSegment = {
  text: string;
  block: number;
  gap: number;
};

const RATE_KEY = "nit-gui:speech-rate";

export const SPEECH_RATES = [0.8, 1, 1.25, 1.5];

function storedRate(): number {
  try {
    const value = Number(window.localStorage.getItem(RATE_KEY));
    if (SPEECH_RATES.includes(value)) return value;
  } catch {}
  return 1;
}

let state: SpeechState = {
  phase: "idle",
  message: null,
  block: -1,
  rate: typeof window === "undefined" ? 1 : storedRate(),
  anchored: false,
};

const listeners = new Set<() => void>();

function setState(patch: Partial<SpeechState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

function subscribeSpeech(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function speechSnapshot(): SpeechState {
  return state;
}

export function useSpeech(): SpeechState {
  return useSyncExternalStore(subscribeSpeech, speechSnapshot, speechSnapshot);
}

function blockGap(block: string): number {
  const trimmed = block.trim();
  if (/^#{1,6}\s/.test(trimmed)) return 0.45;
  if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) return 0.4;
  return 0.3;
}

function pushPiece(pieces: string[], value: string, max: number): void {
  const trimmed = value.trim();
  if (!trimmed) return;
  if (trimmed.length <= max) {
    pieces.push(trimmed);
    return;
  }
  let chunk = "";
  for (const word of trimmed.split(/\s+/)) {
    if (chunk && chunk.length + word.length + 1 > max) {
      pieces.push(chunk);
      chunk = "";
    }
    chunk = chunk ? `${chunk} ${word}` : word;
  }
  if (chunk) pieces.push(chunk);
}

function splitSentences(line: string, max: number): string[] {
  const pieces: string[] = [];
  let start = 0;
  let inCode = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === "`") inCode = !inCode;
    if (inCode || (char !== "." && char !== "!" && char !== "?" && char !== "…")) continue;
    const next = line[index + 1];
    if (next !== undefined && !/\s/.test(next)) continue;
    if (char === "." && /^\s*\d+$/.test(line.slice(0, index))) continue;
    if (char === "." && abbreviation(line.slice(start, index))) continue;
    pushPiece(pieces, line.slice(start, index + 1), max);
    start = index + 1;
  }
  pushPiece(pieces, line.slice(start), max);
  return pieces;
}

const ABBREVIATIONS = new Set(["т", "е", "к", "д", "п", "см", "напр", "др", "г", "ул", "рис", "стр"]);

function abbreviation(prefix: string): boolean {
  const word = /([A-Za-zА-Яа-яЁё]+)$/.exec(prefix)?.[1]?.toLowerCase();
  return Boolean(word && (word.length === 1 || ABBREVIATIONS.has(word)));
}

function splitBlock(block: string, max: number): string[] {
  const trimmed = block.trim();
  if (!trimmed) return [];
  if (trimmed.includes("```") || trimmed.includes("~~~") || trimmed.startsWith("|")) {
    return [trimmed];
  }
  const pieces: string[] = [];
  for (const line of trimmed.split("\n")) {
    if (!line.trim()) continue;
    pieces.push(...splitSentences(line, max));
  }
  return pieces;
}

export function speechSegments(markdown: string, max = 320): SpeechSegment[] {
  const blocks = splitMarkdownBlocks(markdown) ?? [markdown];
  const segments: SpeechSegment[] = [];
  blocks.forEach((block, index) => {
    const gap = blockGap(block);
    const pieces = splitBlock(block, max);
    pieces.forEach((text, piece) => {
      segments.push({
        text,
        block: index,
        gap: piece === pieces.length - 1 ? gap : 0.15,
      });
    });
  });
  return segments;
}

export function splitSpeech(text: string, max = 320): string[] {
  return speechSegments(text, max).map((segment) => segment.text);
}

let sharedContext: AudioContext | null | undefined;

function audioContext(): AudioContext | null {
  if (sharedContext !== undefined) return sharedContext;
  const Constructor =
    typeof window === "undefined"
      ? undefined
      : window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  sharedContext = Constructor ? new Constructor() : null;
  return sharedContext;
}

class PcmPlayer {
  private context: AudioContext;
  private nextAt = 0;
  private started = false;
  private ended = false;
  private active = new Set<AudioBufferSourceNode>();
  private pending = new Uint8Array(0);
  private settled = false;
  private marking: number | null = null;
  private spans: { index: number; start: number; end: number }[] = [];
  private settleDone: (value: "done" | "stopped") => void = () => {};
  readonly done = new Promise<"done" | "stopped">((resolve) => {
    this.settleDone = resolve;
  });

  constructor(context: AudioContext) {
    this.context = context;
  }

  isStarted(): boolean {
    return this.started;
  }

  async consume(response: Response, onStart?: () => void): Promise<void> {
    this.pending = new Uint8Array(0);
    const rate = Number(response.headers.get("X-Audio-Rate")) || 22050;
    const reader = response.body?.getReader();
    if (!reader) throw new Error("no audio stream");
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value?.length) this.push(value, rate, onStart);
    }
  }

  finish(): void {
    this.ended = true;
    this.maybeDone();
  }

  gap(seconds: number): void {
    if (seconds > 0) this.nextAt += seconds;
  }

  mark(index: number): void {
    this.marking = index;
  }

  clearMark(): void {
    this.marking = null;
  }

  time(): number {
    return this.context.currentTime;
  }

  segmentAt(time: number): number | null {
    for (const span of this.spans) {
      if (time >= span.start && time < span.end) return span.index;
    }
    return null;
  }

  async waitWithin(seconds: number): Promise<void> {
    while (!this.ended && this.nextAt - this.context.currentTime > seconds) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  stop(): void {
    this.ended = true;
    for (const source of this.active) {
      try {
        source.stop();
      } catch {}
    }
    this.active.clear();
    this.settle("stopped");
  }

  private push(chunk: Uint8Array, rate: number, onStart?: () => void): void {
    let data = chunk;
    if (this.pending.length) {
      data = new Uint8Array(this.pending.length + chunk.length);
      data.set(this.pending);
      data.set(chunk, this.pending.length);
      this.pending = new Uint8Array(0);
    }
    const samples = Math.floor(data.length / 2);
    if (samples === 0) {
      this.pending = data.slice();
      return;
    }
    const used = samples * 2;
    if (used < data.length) this.pending = data.slice(used);
    const view = new DataView(data.buffer, data.byteOffset, used);
    const floats: Float32Array<ArrayBuffer> = new Float32Array(samples);
    for (let index = 0; index < samples; index += 1) {
      floats[index] = view.getInt16(index * 2, true) / 32768;
    }
    this.schedule(floats, rate);
    if (!this.started) {
      this.started = true;
      onStart?.();
    }
  }

  private schedule(floats: Float32Array<ArrayBuffer>, rate: number): void {
    const buffer = this.context.createBuffer(1, floats.length, rate);
    buffer.copyToChannel(floats, 0);
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);
    const at = Math.max(this.context.currentTime + 0.05, this.nextAt);
    source.start(at);
    this.nextAt = at + buffer.duration;
    if (this.marking !== null) {
      this.spans.push({ index: this.marking, start: at, end: this.nextAt });
      this.marking = null;
    } else if (this.spans.length) {
      this.spans[this.spans.length - 1].end = this.nextAt;
    }
    this.active.add(source);
    source.onended = () => {
      this.active.delete(source);
      this.maybeDone();
    };
  }

  private maybeDone(): void {
    if (this.ended && this.active.size === 0) this.settle("done");
  }

  private settle(value: "done" | "stopped"): void {
    if (this.settled) return;
    this.settled = true;
    this.settleDone(value);
  }
}

let segments: SpeechSegment[] = [];
let shownSegment = -1;
let ticker: ReturnType<typeof setInterval> | null = null;
let activeMessage = "";
let anchored = false;
let fullText = "";
let generation = 0;
let controller: AbortController | null = null;
let player: PcmPlayer | null = null;
let audio: HTMLAudioElement | null = null;
let audioURL: string | null = null;
let kind: "stream" | "audio" | "browser" | null = null;
let gate: Promise<void> | null = null;
let openGate: (() => void) | null = null;
let listenersAttached = false;

const SENTENCE_HIGHLIGHT = "speech";

function highlight(block: number): void {
  clearHighlight();
  if (!anchored || !activeMessage || block < 0 || typeof document === "undefined") return;
  const element = blockElement(block);
  element?.setAttribute("data-speaking", "");
}

function blockElement(block: number): Element | null {
  if (!activeMessage || typeof document === "undefined") return null;
  const root = document.querySelector(`[data-message-id="${escapeValue(activeMessage)}"]`);
  return root?.querySelector(`[data-speech-block="${block}"]`) ?? null;
}

function clearHighlight(): void {
  if (typeof document === "undefined") return;
  for (const element of document.querySelectorAll("[data-speaking]")) {
    element.removeAttribute("data-speaking");
  }
  clearSentenceHighlight();
}

function highlightSentence(block: number, text: string): void {
  clearSentenceHighlight();
  if (!anchored || typeof document === "undefined") return;
  if (typeof CSS === "undefined" || typeof Highlight === "undefined") return;
  const root = blockElement(block);
  if (!root) return;
  const range = rangeFor(root, plainSpeech(text));
  if (range) CSS.highlights.set(SENTENCE_HIGHLIGHT, new Highlight(range));
}

function clearSentenceHighlight(): void {
  if (typeof CSS === "undefined" || typeof Highlight === "undefined") return;
  CSS.highlights.delete(SENTENCE_HIGHLIGHT);
}

function showSegment(index: number): void {
  if (index < 0 || index >= segments.length) return;
  shownSegment = index;
  const segment = segments[index];
  setState({ block: segment.block });
  highlight(segment.block);
  highlightSentence(segment.block, segment.text);
}

function pumpCursor(): void {
  if (!player) return;
  const index = player.segmentAt(player.time());
  if (index === null || index === shownSegment) return;
  showSegment(index);
}

function startTicker(): void {
  if (ticker !== null) return;
  ticker = setInterval(pumpCursor, 120);
}

function stopTicker(): void {
  if (ticker === null) return;
  clearInterval(ticker);
  ticker = null;
}

function plainSpeech(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
    .replace(/^\s*#{1,6}\s+/, "")
    .replace(/^\s*>\s?/, "")
    .replace(/\*\*|__|~~|`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

type FlatText = {
  nodes: { node: Text; start: number; end: number }[];
  text: string;
  normToRaw: number[];
  rawToNorm: number[];
};

function flatText(root: Element): FlatText {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: { node: Text; start: number; end: number }[] = [];
  let raw = "";
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const value = node.nodeValue ?? "";
    if (!value) continue;
    nodes.push({ node: node as Text, start: raw.length, end: raw.length + value.length });
    raw += value;
  }
  const chars: string[] = [];
  const normToRaw: number[] = [];
  const rawToNorm = new Array<number>(raw.length + 1).fill(0);
  let space = false;
  for (let index = 0; index < raw.length; index += 1) {
    rawToNorm[index] = chars.length;
    const char = raw[index];
    const isSpace = /\s/.test(char);
    if (isSpace && (space || chars.length === 0)) continue;
    chars.push(isSpace ? " " : char);
    normToRaw.push(index);
    space = isSpace;
  }
  rawToNorm[raw.length] = chars.length;
  return { nodes, text: chars.join(""), normToRaw, rawToNorm };
}

function rangeFor(root: Element, needle: string): Range | null {
  if (!needle || typeof document === "undefined") return null;
  const info = flatText(root);
  if (!info.text) return null;
  const start = info.text.toLowerCase().indexOf(needle.toLowerCase());
  if (start < 0) return null;
  const end = start + needle.length;
  if (end > info.normToRaw.length) return null;
  const at = (offset: number): { node: Text; offset: number } | null => {
    for (const item of info.nodes) {
      if (offset <= item.end) return { node: item.node, offset: offset - item.start };
    }
    return null;
  };
  const first = at(info.normToRaw[start]);
  const last = at(info.normToRaw[end - 1] + 1);
  if (!first || !last) return null;
  try {
    const range = document.createRange();
    range.setStart(first.node, first.offset);
    range.setEnd(last.node, last.offset);
    return range;
  } catch {
    return null;
  }
}

function caretPoint(x: number, y: number): { node: Node; offset: number } | null {
  if (typeof document === "undefined") return null;
  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  if (typeof doc.caretRangeFromPoint === "function") {
    const range = doc.caretRangeFromPoint(x, y);
    return range ? { node: range.startContainer, offset: range.startOffset } : null;
  }
  if (typeof doc.caretPositionFromPoint === "function") {
    const position = doc.caretPositionFromPoint(x, y);
    return position ? { node: position.offsetNode, offset: position.offset } : null;
  }
  return null;
}

function segmentAtPoint(
  root: Element,
  block: number,
  point: { node: Node; offset: number },
): number | null {
  if (!root.contains(point.node) || point.node.nodeType !== Node.TEXT_NODE) return null;
  const info = flatText(root);
  const node = info.nodes.find((item) => item.node === point.node);
  if (!node) return null;
  const offset = info.rawToNorm[node.start + point.offset] ?? info.text.length;
  const haystack = info.text.toLowerCase();
  let from = 0;
  let target: number | null = null;
  let next: number | null = null;
  segments.forEach((segment, index) => {
    if (segment.block !== block) return;
    const needle = plainSpeech(segment.text).toLowerCase();
    if (!needle) return;
    const start = haystack.indexOf(needle, from);
    if (start < 0) return;
    const end = start + needle.length;
    from = end;
    if (offset >= start && offset <= end) target = target ?? index;
    if (next === null && start > offset) next = index;
  });
  return target ?? next;
}

function escapeValue(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
  return value.replace(/["\\]/g, "\\$&");
}

function release(): void {
  generation += 1;
  controller?.abort();
  controller = null;
  player?.stop();
  player = null;
  if (audio) {
    audio.onended = null;
    audio.onerror = null;
    audio.pause();
    audio = null;
  }
  if (audioURL) {
    URL.revokeObjectURL(audioURL);
    audioURL = null;
  }
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
  if (typeof window !== "undefined") void sharedContext?.resume().catch(() => {});
  openGate?.();
  openGate = null;
  gate = null;
  kind = null;
  segments = [];
  shownSegment = -1;
  stopTicker();
}

function finish(): void {
  release();
  activeMessage = "";
  anchored = false;
  fullText = "";
  setState({ phase: "idle", message: null, block: -1, anchored: false });
  clearHighlight();
  detach();
}

export function stopSpeech(): void {
  if (state.phase === "idle" && !kind) {
    clearHighlight();
    return;
  }
  finish();
}

export function pauseSpeech(): void {
  if (state.phase !== "playing") return;
  if (kind === "browser" && typeof window !== "undefined") {
    window.speechSynthesis.pause();
  } else if (kind === "audio") {
    audio?.pause();
  } else {
    void audioContext()?.suspend().catch(() => {});
  }
  setState({ phase: "paused" });
}

export function resumeSpeech(): void {
  if (state.phase !== "paused") return;
  if (kind === "browser" && typeof window !== "undefined") {
    window.speechSynthesis.resume();
  } else if (kind === "audio") {
    void audio?.play().catch(() => {});
  } else {
    void audioContext()?.resume().catch(() => {});
  }
  openGate?.();
  openGate = null;
  gate = null;
  setState({ phase: "playing" });
}

export function setSpeechRate(rate: number): void {
  if (!SPEECH_RATES.includes(rate)) return;
  setState({ rate });
  try {
    window.localStorage.setItem(RATE_KEY, String(rate));
  } catch {}
}

async function waitGate(gen: number): Promise<void> {
  while (gen === generation && state.phase === "paused") {
    if (!gate) {
      gate = new Promise<void>((resolve) => {
        openGate = resolve;
      });
    }
    await gate;
  }
}

function requestStream(text: string, signal: AbortSignal): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const instance = getInstance();
  if (instance) headers["X-Nit-Instance"] = instance;
  return fetch(appPath("/api/tts/stream"), {
    method: "POST",
    headers,
    body: JSON.stringify({ text, rate: state.rate }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(45_000)]),
  });
}

async function run(gen: number, from: number): Promise<void> {
  const context = audioContext();
  if (!context) {
    await fallbackAudio(gen);
    return;
  }
  void context.resume().catch(() => {});
  const current = new PcmPlayer(context);
  player = current;
  kind = "stream";
  controller = new AbortController();
  const signal = controller.signal;
  let prefetched: Promise<Response> | null = requestStream(segments[from].text, signal);
  try {
    for (let index = from; index < segments.length; index += 1) {
      if (gen !== generation) return;
      await waitGate(gen);
      if (gen !== generation) return;
      const response = await prefetched!;
      if (gen !== generation) return;
      prefetched =
        index + 1 < segments.length ? requestStream(segments[index + 1].text, signal) : null;
      if (response.status === 400) continue;
      if (!response.ok) throw new Error("speech failed");
      current.mark(index);
      await current.consume(response, () => {
        if (gen === generation) setState({ phase: "playing" });
      });
      current.clearMark();
      current.gap(segments[index].gap);
      await current.waitWithin(6);
    }
    current.finish();
    await current.done;
    if (gen !== generation) return;
    finish();
  } catch {
    if (gen !== generation) return;
    if (!current.isStarted()) {
      current.stop();
      player = null;
      await fallbackAudio(gen);
      return;
    }
    finish();
  }
}

async function fallbackAudio(gen: number): Promise<void> {
  setState({ phase: "loading" });
  try {
    const blob = await api.ttsAudio(fullText, state.rate, controller?.signal);
    if (gen !== generation) return;
    const url = URL.createObjectURL(blob);
    audioURL = url;
    kind = "audio";
    const element = new Audio(url);
    audio = element;
    element.onended = () => {
      if (gen === generation) finish();
    };
    element.onerror = () => {
      if (gen === generation) browserSpeech(gen);
    };
    await element.play();
    if (gen !== generation) return;
    setState({ phase: "playing" });
  } catch {
    if (gen !== generation) return;
    browserSpeech(gen);
  }
}

function browserSpeech(gen: number): void {
  if (gen !== generation) return;
  if (typeof window === "undefined" || !("speechSynthesis" in window) || !fullText.trim()) {
    finish();
    return;
  }
  const utterance = new SpeechSynthesisUtterance(fullText);
  utterance.lang = /[А-Яа-яЁё]/.test(fullText) ? "ru-RU" : "en-US";
  utterance.onend = () => {
    if (gen === generation) finish();
  };
  utterance.onerror = () => {
    if (gen === generation) finish();
  };
  kind = "browser";
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
  setState({ phase: "playing" });
}

function begin(
  messageId: string,
  text: string,
  items: SpeechSegment[],
  isAnchored: boolean,
): void {
  release();
  if (items.length === 0) {
    setState({ phase: "idle", message: null, block: -1, anchored: false });
    return;
  }
  activeMessage = messageId;
  anchored = isAnchored;
  fullText = text;
  segments = items;
  attach();
  setState({ phase: "loading", message: messageId, anchored: isAnchored });
  showSegment(0);
  startTicker();
  const gen = generation + 1;
  generation = gen;
  void run(gen, 0);
}

export function startReading(messageId: string, text: string): void {
  const value = text.trim();
  if (!value) return;
  if (state.phase === "paused" && state.message === messageId && anchored) {
    resumeSpeech();
    return;
  }
  begin(messageId, value, speechSegments(value), true);
}

export function readSelection(messageId: string, text: string): void {
  const value = text.trim();
  if (!value) return;
  begin(messageId, value, [{ text: value, block: -1, gap: 0 }], false);
}

function restart(index: number): void {
  if (!segments.length) return;
  const gen = generation + 1;
  generation = gen;
  controller?.abort();
  controller = null;
  player?.stop();
  player = null;
  openGate?.();
  openGate = null;
  gate = null;
  void audioContext()?.resume().catch(() => {});
  setState({ phase: "loading" });
  showSegment(index);
  startTicker();
  void run(gen, index);

}

export function jumpToBlock(block: number): void {
  if (!anchored || !segments.length) return;
  const index = segments.findIndex((segment) => segment.block >= block);
  if (index >= 0) restart(index);
}

export function previousSentence(): void {
  if (!anchored || !segments.length) return;
  restart(Math.max(0, shownSegment - 1));
}

function onDocumentClick(event: MouseEvent): void {
  if (!anchored || !activeMessage) return;
  if (state.phase !== "playing" && state.phase !== "paused") return;
  const target = event.target as Element | null;
  if (!target || typeof target.closest !== "function") return;
  if (target.closest("a,button,input,textarea,select,[contenteditable='true']")) return;
  const block = target.closest("[data-speech-block]");
  const root = target.closest("[data-message-id]");
  if (!block || !root || root.getAttribute("data-message-id") !== activeMessage) return;
  if (typeof window !== "undefined" && window.getSelection()?.toString()) return;
  const blockIndex = Number(block.getAttribute("data-speech-block"));
  if (!Number.isFinite(blockIndex)) return;
  const point = caretPoint(event.clientX, event.clientY);
  const index = point ? segmentAtPoint(block, blockIndex, point) : null;
  if (index !== null) restart(index);
  else jumpToBlock(blockIndex);
}

function onDocumentKey(event: KeyboardEvent): void {
  if (event.key === "Escape" && state.phase !== "idle") {
    stopSpeech();
  }
}

function attach(): void {
  if (listenersAttached || typeof document === "undefined") return;
  document.addEventListener("click", onDocumentClick);
  document.addEventListener("keydown", onDocumentKey);
  listenersAttached = true;
}

function detach(): void {
  if (!listenersAttached || typeof document === "undefined") return;
  document.removeEventListener("click", onDocumentClick);
  document.removeEventListener("keydown", onDocumentKey);
  listenersAttached = false;
}
