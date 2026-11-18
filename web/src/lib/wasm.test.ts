import { describe, expect, it } from "vitest";
import { wasmInfo } from "./wasm";

function bytes(...values: number[]): ArrayBuffer {
  return new Uint8Array(values).buffer;
}

describe("wasmInfo", () => {
  it("rejects a file without the wasm magic", () => {
    expect(wasmInfo(bytes(0x50, 0x4b, 3, 4))).toBeNull();
  });

  it("reads the version and section headers", () => {
    const info = wasmInfo(bytes(0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, 1, 1, 0));
    expect(info).not.toBeNull();
    expect(info!.version).toBe(1);
    expect(info!.sections).toEqual([{ id: 1, name: "type", size: 1, offset: 10 }]);
  });

  it("reads a custom section name", () => {
    const info = wasmInfo(bytes(0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, 0, 3, 2, 0x68, 0x69));
    expect(info!.sections[0]).toEqual({ id: 0, name: "custom: hi", size: 3, offset: 10 });
  });
});
