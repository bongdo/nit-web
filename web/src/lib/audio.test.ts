import { describe, expect, it } from "vitest";
import { encodeWav } from "./audio";

describe("audio", () => {
  it("encodes mono 16 kHz PCM WAV and downsamples", async () => {
    const blob = encodeWav([new Float32Array(48_000)], 48_000);
    expect(blob.type).toBe("audio/wav");
    expect(blob.size).toBe(44 + 16_000 * 2);

    const view = new DataView(await blob.arrayBuffer());
    const tag = (offset: number) =>
      String.fromCharCode(...[0, 1, 2, 3].map((i) => view.getUint8(offset + i)));
    expect(tag(0)).toBe("RIFF");
    expect(tag(8)).toBe("WAVE");
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint16(34, true)).toBe(16);
  });

  it("keeps a short recording at least one sample", async () => {
    const blob = encodeWav([new Float32Array([0.5, -0.5])], 48_000);
    expect(blob.size).toBe(46);
  });
});
