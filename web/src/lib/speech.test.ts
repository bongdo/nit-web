import { afterEach, describe, expect, it, vi } from "vitest";
import { speechSegments, speechSnapshot, splitSpeech, startReading, stopSpeech } from "./speech";

describe("splitSpeech", () => {
  it("keeps paragraphs as separate segments", () => {
    expect(splitSpeech("Первое предложение.\n\nВторое предложение.")).toEqual([
      "Первое предложение.",
      "Второе предложение.",
    ]);
  });

  it("splits a long paragraph at sentence boundaries", () => {
    const text = "Первое предложение. ".repeat(30).trim();
    const segments = splitSpeech(text, 80);
    expect(segments.length).toBeGreaterThan(1);
    for (const segment of segments) {
      expect(segment.length).toBeLessThanOrEqual(80);
      expect(segment.endsWith(".")).toBe(true);
    }
  });

  it("never splits a fenced code block", () => {
    const text = "Код:\n\n```go\nfunc main() {\n\n\n}\n```\n\nГотово.";
    expect(splitSpeech(text, 20)).toEqual(["Код:", "```go\nfunc main() {\n\n\n}\n```", "Готово."]);
  });

  it("returns nothing for blank text", () => {
    expect(splitSpeech("  \n\n ")).toEqual([]);
  });
});

describe("speechSegments", () => {
  it("keeps every segment tied to its markdown block", () => {
    const segments = speechSegments("# Заголовок\n\nПервый абзац.\n\n```go\nx\n```\n\nПоследний.");
    expect(segments.map((segment) => segment.block)).toEqual([0, 1, 2, 3]);
    expect(segments[0].gap).toBe(0.45);
    expect(segments[2].gap).toBe(0.4);
    expect(segments[3].gap).toBe(0.3);
  });

  it("splits a paragraph into one segment per sentence", () => {
    const segments = speechSegments("Первое. Второе! Третье?");
    expect(segments.map((segment) => segment.text)).toEqual(["Первое.", "Второе!", "Третье?"]);
    expect(new Set(segments.map((segment) => segment.block))).toEqual(new Set([0]));
    expect(segments.slice(0, -1).every((segment) => segment.gap === 0.15)).toBe(true);
    expect(segments.at(-1)?.gap).toBe(0.3);
  });

  it("does not split abbreviations or initials", () => {
    expect(splitSpeech("Замени т.е. вот это. Готово.")).toEqual([
      "Замени т.е. вот это.",
      "Готово.",
    ]);
  });

  it("keeps ordered list markers whole", () => {
    const segments = speechSegments("1. Первый пункт\n2. Второй пункт");
    expect(segments.map((segment) => segment.text)).toEqual([
      "1. Первый пункт",
      "2. Второй пункт",
    ]);
  });
});

class FakeSource {
  onended: (() => void) | null = null;
  start() {
    queueMicrotask(() => this.onended?.());
  }
  stop() {}
  connect() {}
}

class FakeContext {
  currentTime = 0;
  destination = {};
  resume() {
    return Promise.resolve();
  }
  suspend() {
    return Promise.resolve();
  }
  createBuffer(_channels: number, length: number, rate: number) {
    return {
      duration: length / rate,
      copyToChannel() {},
    } as unknown as AudioBuffer;
  }
  createBufferSource() {
    return new FakeSource() as unknown as AudioBufferSourceNode;
  }
}

afterEach(() => {
  stopSpeech();
  vi.unstubAllGlobals();
});

describe("reading", () => {
  it("streams every block and returns to idle", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array([0, 0, 1, 0, 2, 0, 3, 0]));
              controller.close();
            },
          }),
          { headers: { "X-Audio-Rate": "22050" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", { AudioContext: FakeContext });

    startReading("msg_1", "Первое предложение.\n\nВторое предложение.");
    for (let step = 0; step < 50 && speechSnapshot().phase !== "idle"; step += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(speechSnapshot().phase).toBe("idle");
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body).toMatchObject({ text: "Первое предложение.", rate: 1 });
  });
});
