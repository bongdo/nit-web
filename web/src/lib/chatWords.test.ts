import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chatText, ignoreWords, loadIgnoredWords } from "./chatWords";
import type { Message } from "./types";

function message(patch: Partial<Message>): Message {
  return { id: `m${Math.random()}`, type: "assistant", time: { created: 0 }, ...patch };
}

function storage() {
  const data = new Map<string, string>();
  return {
    data,
    store: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
      clear: () => data.clear(),
      key: (index: number) => Array.from(data.keys())[index] ?? null,
      get length() {
        return data.size;
      },
    } as Storage,
  };
}

describe("chatText", () => {
  it("keeps user text and assistant prose but not reasoning or tool output", () => {
    const text = chatText([
      message({ type: "user", text: "привет" }),
      message({
        content: [
          { type: "text", text: "ответ" },
          { type: "reasoning", text: "размышление" },
          {
            type: "tool",
            id: "tool",
            name: "bash",
            state: { status: "completed", content: [{ type: "text", text: "output" }] },
          },
        ],
      }),
      message({ type: "compaction" }),
    ]);
    expect(text).toBe("привет\nответ");
  });

  it("keeps only the tail of a long chat", () => {
    const text = chatText([message({ type: "user", text: "a".repeat(30_000) + "tail" })]);
    expect(text.length).toBe(20_000);
    expect(text.endsWith("tail")).toBe(true);
  });
});

describe("ignored words", () => {
  let local: ReturnType<typeof storage>;

  beforeEach(() => {
    local = storage();
    vi.stubGlobal("localStorage", local.store);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps an ignored word across reloads and ignores its case", () => {
    ignoreWords(["Executables"]);
    ignoreWords(["executables"]);
    ignoreWords([" "]);
    expect(local.data.get("nit-gui.spell-ignore")).toBe('["executables"]');
    expect(loadIgnoredWords()).toEqual(["executables"]);
  });

  it("lowercases words stored by older builds", () => {
    local.store.setItem("nit-gui.spell-ignore", JSON.stringify(["НitGUI"]));
    expect(loadIgnoredWords()).toEqual(["нitgui"]);
  });

  it("survives a storage that refuses to write", () => {
    vi.stubGlobal("localStorage", {
      ...local.store,
      setItem: () => {
        throw new Error("quota");
      },
    });
    expect(() => ignoreWords(["хочю"])).not.toThrow();
    expect(loadIgnoredWords()).toEqual([]);
  });
});
