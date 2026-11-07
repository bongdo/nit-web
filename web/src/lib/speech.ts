import { appPath } from "./base";
import { getInstance } from "./api";

export type SpeechHandle = {
  stop: () => void;
  started: () => boolean;
  done: Promise<"done" | "stopped">;
};

export function splitSpeech(text: string, max = 320): string[] {
  const blocks: string[] = [];
  const current: string[] = [];
  let inFence = false;
  const flush = () => {
    const value = current.join("\n").trim();
    if (value) blocks.push(value);
    current.length = 0;
  };
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) inFence = !inFence;
    if (!inFence && trimmed === "") {
      flush();
      continue;
    }
    current.push(line);
  }
  flush();

  const segments: string[] = [];
  for (const block of blocks) {
    if (block.length <= max || block.includes("```") || block.includes("~~~")) {
      segments.push(block);
      continue;
    }
    const sentences = block.match(/[^.!?…]+[.!?…]+(?:\s+|$)/g) ?? [block];
    let chunk = "";
    for (const sentence of sentences) {
      if (chunk && chunk.length + sentence.length > max) {
        segments.push(chunk.trim());
        chunk = "";
      }
      chunk += sentence;
    }
    if (chunk.trim()) segments.push(chunk.trim());
  }
  return segments;
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
  private resolveDone: () => void = () => {};
  readonly done = new Promise<"done" | "stopped">((resolve) => {
    this.resolveDone = () => resolve("done");
  });

  constructor(context: AudioContext) {
    this.context = context;
  }

  isStarted(): boolean {
    return this.started;
  }

  async consume(response: Response, onStart?: () => void): Promise<void> {
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

  stop(): void {
    this.ended = true;
    for (const source of this.active) {
      try {
        source.stop();
      } catch {}
    }
    this.active.clear();
    this.resolveDone = () => {};
    this.done.then(() => {});
    this.ended = true;
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
    const floats = new Float32Array(samples);
    for (let index = 0; index < samples; index += 1) {
      floats[index] = view.getInt16(index * 2, true) / 32768;
    }
    this.schedule(floats, rate);
    if (!this.started) {
      this.started = true;
      onStart?.();
    }
  }

  private schedule(floats: Float32Array, rate: number): void {
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
    if (this.ended && this.active.size === 0) this.resolveDone();
  }
}

export function speakHost(text: string, onStart?: () => void): SpeechHandle | null {
  const context = audioContext();
  if (!context) return null;
  void context.resume().catch(() => {});
  const controller = new AbortController();
  const player = new PcmPlayer(context);
  const segments = splitSpeech(text);
  let prefetch = segments.length ? requestStream(segments[0], controller.signal) : null;
  const done = (async () => {
    for (let index = 0; index < segments.length; index += 1) {
      const response = await prefetch!;
      if (!response.ok) throw new Error(`speech failed (${response.status})`);
      prefetch = index + 1 < segments.length ? requestStream(segments[index + 1], controller.signal) : null;
      await player.consume(response, onStart);
    }
    player.finish();
    return player.done;
  })();
  const settled = done.catch(() => {
    if (controller.signal.aborted) return "stopped" as const;
    throw new Error("speech failed");
  });
  return {
    stop: () => {
      controller.abort();
      player.stop();
    },
    started: () => player.isStarted(),
    done: settled,
  };
}

function requestStream(text: string, signal: AbortSignal): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const instance = getInstance();
  if (instance) headers["X-Nit-Instance"] = instance;
  return fetch(appPath("/api/tts/stream"), {
    method: "POST",
    headers,
    body: JSON.stringify({ text }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(45_000)]),
  });
}
