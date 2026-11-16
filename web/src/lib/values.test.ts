import { describe, expect, it } from "vitest";
import { splitValues } from "./values";

const marked = (text: string) =>
  splitValues(text)
    .map((part) => (typeof part === "string" ? part : `[${part.kind}:${part.text}]`))
    .join("");

describe("splitValues", () => {
  it("marks numbers with english units", () => {
    expect(marked("шапка 260px и 512 mb")).toBe("шапка [value:260px] и [value:512 mb]");
    expect(marked("заняло 750 ms, 3.46s и 20%")).toBe(
      "заняло [value:750 ms], [value:3.46s] и [value:20%]",
    );
    expect(marked("16 tokens, 3 min, 2 kb")).toBe("[value:16 tokens], [value:3 min], [value:2 kb]");
  });

  it("marks numbers with russian units", () => {
    expect(marked("ждать 0.5 дня")).toBe("ждать [value:0.5 дня]");
    expect(marked("весит 8 МБ, 700 мс, 5 мин")).toBe(
      "весит [value:8 МБ], [value:700 мс], [value:5 мин]",
    );
    expect(marked("2,5 секунды и 12 запросов")).toBe("[value:2,5 секунды] и [value:12 запросов]");
    expect(marked("3 дня, 4 недели, 2 месяца")).toBe(
      "[value:3 дня], [value:4 недели], [value:2 месяца]",
    );
  });

  it("marks money, ids and task numbers", () => {
    expect(marked("цена $0.16 и €5")).toBe("цена [value:$0.16] и [value:€5]");
    expect(marked("чат ses_e19f2b2e6ffeV3dzPGBs7Ho07R")).toBe(
      "чат [id:ses_e19f2b2e6ffeV3dzPGBs7Ho07R]",
    );
    expect(marked("T12 и #10")).toBe("[id:T12] и [id:#10]");
  });

  it("leaves bare numbers, paths and versions alone", () => {
    expect(marked("в 2026 году")).toBe("в 2026 году");
    expect(marked("web/src/app.tsx:42")).toBe("web/src/app.tsx:42");
    expect(marked("версия 2.2.5, 4/5")).toBe("версия 2.2.5, 4/5");
    expect(marked("5 разв")).toBe("5 разв");
  });
});
