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

function splitChunks(block: string, max: number): string[] {
  const trimmed = block.trim();
  if (!trimmed) return [];
  if (trimmed.length <= max || trimmed.includes("```") || trimmed.includes("~~~")) {
    return [trimmed];
  }
  const sentences = trimmed.match(/[^.!?…]+[.!?…]+(?:\s+|$)/g) ?? [trimmed];
  const chunks: string[] = [];
  let chunk = "";
  for (const sentence of sentences) {
    if (chunk && chunk.length + sentence.length > max) {
      chunks.push(chunk.trim());
      chunk = "";
    }
    chunk += sentence;
  }
  if (chunk.trim()) chunks.push(chunk.trim());
  return chunks;
}

export function speechSegments(markdown: string, max = 320): SpeechSegment[] {
  const blocks = splitMarkdownBlocks(markdown) ?? [markdown];
  const segments: SpeechSegment[] = [];
  blocks.forEach((block, index) => {
    const gap = blockGap(block);
    const chunks = splitChunks(block, max);
    chunks.forEach((text, chunk) => {
      segments.push({
        text,
        block: index,
        gap: chunk === chunks.length - 1 ? gap : 0.12,
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
let cursor = 0;
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

function highlight(block: number): void {
  clearHighlight();
  if (!anchored || !activeMessage || block < 0 || typeof document === "undefined") return;
  const root = document.querySelector(`[data-message-id="${escapeValue(activeMessage)}"]`);
  const element = root?.querySelector(`[data-speech-block="${block}"]`);
  element?.setAttribute("data-speaking", "");
}

function clearHighlight(): void {
  if (typeof document === "undefined") return;
  for (const element of document.querySelectorAll("[data-speaking]")) {
    element.removeAttribute("data-speaking");
  }
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
  if (kind === "stream") {
    void audioContext()?.suspend().catch(() => {});
  } else if (kind === "audio") {
    audio?.pause();
  } else if (kind === "browser" && typeof window !== "undefined") {
    window.speechSynthesis.pause();
  }
  setState({ phase: "paused" });
}

export function resumeSpeech(): void {
  if (state.phase !== "paused") return;
  if (kind === "stream") {
    void audioContext()?.resume().catch(() => {});
    openGate?.();
    openGate = null;
    gate = null;
  } else if (kind === "audio") {
    void audio?.play().catch(() => {});
  } else if (kind === "browser" && typeof window !== "undefined") {
    window.speechSynthesis.resume();
  }
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
  controller = new AbortController();
  const signal = controller.signal;
  let prefetched: Promise<Response> | null = requestStream(segments[from].text, signal);
  try {
    for (let index = from; index < segments.length; index += 1) {
      if (gen !== generation) return;
      cursor = index;
      setState({ block: segments[index].block });
      highlight(segments[index].block);
      const response = await prefetched!;
      if (gen !== generation) return;
      prefetched =
        index + 1 < segments.length ? requestStream(segments[index + 1].text, signal) : null;
      if (response.status === 400) continue;
      if (!response.ok) throw new Error("speech failed");
      await current.consume(response, () => {
        if (gen === generation) setState({ phase: "playing" });
      });
      current.gap(segments[index].gap);
      await waitGate(gen);
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
  cursor = 0;
  attach();
  setState({
    phase: "loading",
    message: messageId,
    block: items[0].block,
    anchored: isAnchored,
  });
  const gen = generation + 1;
  generation = gen;
  if (isAnchored) highlight(items[0].block);
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
  cursor = index;
  void audioContext()?.resume().catch(() => {});
  setState({ phase: "loading", block: segments[index].block });
  highlight(segments[index].block);
  void run(gen, index);
}

export function jumpToBlock(block: number): void {
  if (!anchored || !segments.length) return;
  const index = segments.findIndex((segment) => segment.block >= block);
  if (index < 0 || index === cursor) return;
  restart(index);
}

export function previousBlock(): void {
  if (!anchored || !segments.length) return;
  const starts: number[] = [];
  for (let index = 0; index < segments.length; index += 1) {
    if (index === 0 || segments[index].block !== segments[index - 1].block) starts.push(index);
  }
  const position = starts.findIndex((start) => segments[start].block === state.block);
  if (position <= 0) {
    restart(0);
    return;
  }
  restart(starts[position - 1]);
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
  const index = Number(block.getAttribute("data-speech-block"));
  if (Number.isFinite(index)) jumpToBlock(index);
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
