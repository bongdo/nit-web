import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "./Markdown";

const render = (text: string) => renderToStaticMarkup(<Markdown text={text} />);

describe("Markdown values", () => {
  it("marks numbers with units and ids in prose", () => {
    const html = render("Память 8 МБ, чат ses_e19f2b2e6ffe и задача T12.");
    expect(html).toContain('class="md-value">8 МБ</span>');
    expect(html).toContain('class="md-id">ses_e19f2b2e6ffe</span>');
    expect(html).toContain('class="md-id">T12</span>');
  });

  it("keeps code spans untouched", () => {
    const html = render("Задай `260px` в настройках.");
    expect(html).toContain("<code>260px</code>");
    expect(html).not.toContain('class="md-value"');
  });

  it("right-aligns a fully numeric column", () => {
    const html = render("| файл | размер |\n| --- | --- |\n| a | 12 MB |\n| b | 3 KB |");
    expect(html.match(/md-num/g) ?? []).toHaveLength(3);
  });

  it("keeps mixed columns left-aligned", () => {
    const html = render("| случай | цена |\n| --- | --- |\n| a | ~1 день |\n| b | недели |");
    expect(html).not.toContain("md-num");
    expect(html).toContain('class="md-value"');
  });
});
