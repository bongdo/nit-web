export type WasmSection = { id: number; name: string; size: number; offset: number };

export type WasmInfo = { version: number; size: number; sections: WasmSection[] };

const SECTION_NAMES: Record<number, string> = {
  0: "custom",
  1: "type",
  2: "import",
  3: "function",
  4: "table",
  5: "memory",
  6: "global",
  7: "export",
  8: "start",
  9: "element",
  10: "code",
  11: "data",
  12: "data count",
  13: "tag",
};

function leb(bytes: Uint8Array, at: number): { value: number; next: number } {
  let value = 0;
  let shift = 0;
  let next = at;
  while (next < bytes.length) {
    const byte = bytes[next++]!;
    value += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) return { value, next };
    shift += 7;
    if (shift > 49) break;
  }
  throw new Error("invalid LEB128");
}

export function wasmInfo(buffer: ArrayBuffer): WasmInfo | null {
  const bytes = new Uint8Array(buffer);
  if (
    bytes.length < 8 ||
    bytes[0] !== 0 ||
    bytes[1] !== 0x61 ||
    bytes[2] !== 0x73 ||
    bytes[3] !== 0x6d
  ) {
    return null;
  }
  const version = new DataView(buffer).getUint32(4, true);
  const sections: WasmSection[] = [];
  let at = 8;
  while (at < bytes.length) {
    const id = bytes[at++]!;
    const size = leb(bytes, at);
    at = size.next;
    let name = SECTION_NAMES[id] ?? `section ${id}`;
    if (id === 0 && size.value > 0) {
      try {
        const length = leb(bytes, at);
        const end = Math.min(bytes.length, length.next + length.value);
        name = `custom: ${new TextDecoder().decode(bytes.subarray(length.next, end))}`;
      } catch {
        name = "custom";
      }
    }
    sections.push({ id, name, size: size.value, offset: at });
    at += size.value;
    if (at > bytes.length) break;
  }
  return { version, size: bytes.length, sections };
}
