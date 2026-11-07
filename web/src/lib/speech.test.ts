import { afterEach, describe, expect, it, vi } from "vitest";
import { speakHost, splitSpeech } from "./speech";

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

class FakeSource {
  onended: (() => void) | null = null;
  started = false;
  stopped = false;
  start() {
    this.started = true;
    queueMicrotask(() => this.onended?.());
  }
  stop() {
    this.stopped = true;
  }
  connect() {}
}

class FakeContext {
  currentTime = 0;
  destination = {};
  resume() {
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
  vi.unstubAllGlobals();
});

describe("speakHost", () => {
  it("requests every segment and finishes after playback", async () => {
    const fetchMock = vi.fn(async () =>
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
    let started = false;
    const handle = speakHost("Первое предложение.\n\nВторое предложение.", () => {
      started = true;
    });
    expect(handle).not.toBeNull();
    await expect(handle!.done).resolves.toBe("done");
    expect(started).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
