import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "./Markdown";
import { MarkdownLazy } from "./MarkdownLazy";

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

  it("opens a path in inline code in the viewer, with pero behind shift", () => {
    const html = renderToStaticMarkup(
      <Markdown text={"Открой `bin/check` и `docs/decisions.md:12`."} directory="/work/app" peroURL="/pero/" />,
    );
    expect(html).toContain("md-file");
    expect(html).toContain("/view?path=%2Fwork%2Fapp%2Fbin%2Fcheck");
    expect(html).toContain('data-pero-href="/pero/?open=%2Fwork%2Fapp%2Fbin%2Fcheck"');
    expect(html).toContain("data-pero-href=\"/pero/?open=%2Fwork%2Fapp%2Fdocs%2Fdecisions.md&amp;lines=12\"");
  });

  it("links a path in inline code while streaming", () => {
    const html = renderToStaticMarkup(
      <Markdown text={"Открой `bin/check`."} streaming directory="/work/app" peroURL="/pero/" />,
    );
    expect(html).toContain('class="md-file"');
    expect(html).toContain("/view?path=%2Fwork%2Fapp%2Fbin%2Fcheck");
  });

  it("does not link paths without a directory", () => {
    const html = renderToStaticMarkup(<Markdown text={"Открой `bin/check`."} peroURL="/pero/" />);
    expect(html).not.toContain("md-file");
  });

  it("puts a file icon before a linked mention", () => {
    const html = renderToStaticMarkup(
      <Markdown text={"Открой `src/main.c3`."} directory="/work/app" peroURL="/pero/" />,
    );
    expect(html).toMatch(/class="md-file"[^>]*>\s*<svg/);
  });

  it("marks an executable in bin with a terminal icon", () => {
    const html = renderToStaticMarkup(
      <Markdown text={"Открой `bin/deploy`."} directory="/work/app" peroURL="/pero/" />,
    );
    expect(html).toContain("lucide-file-terminal");
    expect(html).not.toContain("lucide-file-icon");
  });

  it("dims brackets in plain inline code", () => {
    const html = render("Вызови `foo(1)`.");
    expect(html).toContain('class="md-punct"');
  });

  it("highlights a fenced block with the shared tokenizer", () => {
    const html = render("```c3\nmodule main;\n```");
    expect(html).toContain('class="syn-keyword">module</span>');
    expect(html).toContain('class="syn-punctuation">;</span>');
  });

  it("keeps mixed columns left-aligned", () => {
    const html = render("| случай | цена |\n| --- | --- |\n| a | ~1 день |\n| b | недели |");
    expect(html).not.toContain("md-num");
    expect(html).toContain('class="md-value"');
  });
});

describe("MarkdownLazy", () => {
  it("shows plain text while the chunk loads, without parsing", () => {
    const html = renderToStaticMarkup(
      <MarkdownLazy text={"Первый абзац.\n\n**Второй**"} streaming />,
    );
    expect(html).toContain("whitespace-pre-wrap");
    expect(html).toContain("Первый абзац.");
    expect(html).not.toContain("<strong>");
  });

  it("renders the same markup as the direct import once resolved", async () => {
    const text = "Первый абзац.\n\nВторой **абзац**.";
    const settled = async () => {
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          return renderToStaticMarkup(<MarkdownLazy text={text} />);
        } catch (thrown) {
          if (!(thrown instanceof Promise)) throw thrown;
          await thrown;
        }
      }
      throw new Error("markdown chunk never resolved");
    };
    expect(await settled()).toBe(render(text));
  });
});
