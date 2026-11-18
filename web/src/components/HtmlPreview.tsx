import { useEffect, useRef, useState } from "react";
import { htmlDocument } from "../lib/html";
import { cn } from "../lib/utils";

function readTheme() {
  const root = document.documentElement;
  return {
    dark: root.classList.contains("dark"),
    background: getComputedStyle(root).getPropertyValue("--background").trim() || "#fff",
  };
}

const RESIZE = `<script>
(() => {
  const send = () => parent.postMessage({ type: "nit-html-height", height: Math.ceil(document.documentElement.scrollHeight) }, "*");
  addEventListener("load", send);
  if (window.ResizeObserver) new ResizeObserver(send).observe(document.documentElement);
  setTimeout(send, 50);
})();
</script>`;

const ANNOTATE = `<script>
(() => {
  let current = null;
  const path = (element) => {
    const parts = [];
    while (element && element.nodeType === 1 && parts.length < 5) {
      if (element.id) {
        parts.unshift(element.tagName.toLowerCase() + "#" + element.id);
        break;
      }
      let part = element.tagName.toLowerCase();
      const classes = Array.from(element.classList || []).filter((name) => name.indexOf("nit-") !== 0).slice(0, 2);
      if (classes.length) part += "." + classes.join(".");
      const parent = element.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter((node) => node.tagName === element.tagName);
        if (same.length > 1) part += ":nth-of-type(" + (same.indexOf(element) + 1) + ")";
      }
      parts.unshift(part);
      element = element.parentElement;
    }
    return parts.join(" > ");
  };
  const tableRef = (element) => {
    const cell = element.closest("td,th");
    if (!cell) return "";
    const row = cell.parentElement;
    const table = cell.closest("table");
    if (!row || !table) return "";
    const rows = Array.from(table.querySelectorAll("tr"));
    const rowIndex = rows.indexOf(row) + 1;
    const cells = Array.from(row.children);
    const columnIndex = cells.indexOf(cell) + 1;
    const head = table.querySelector("thead tr");
    const label = head && head.children[columnIndex - 1] ? head.children[columnIndex - 1].textContent.trim() : "";
    return "table row " + rowIndex + ", column " + columnIndex + (label ? " («" + label + "»)" : "");
  };
  document.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const element = event.target.closest("body *");
    if (!element || element === document.body || element === document.documentElement) return;
    if (current) current.style.outline = "";
    current = element;
    element.style.outline = "2px solid #3b82f6";
    element.style.outlineOffset = "-2px";
    const rect = element.getBoundingClientRect();
    parent.postMessage({
      type: "nit-annotate",
      selector: path(element),
      tag: element.tagName.toLowerCase(),
      text: (element.textContent || "").trim().slice(0, 160),
      table: tableRef(element),
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
    }, "*");
  }, true);
})();
</script>`;

export type HtmlAnnotation = {
  selector: string;
  tag: string;
  text: string;
  table?: string;
  rect: { left: number; top: number; width: number; height: number };
};

const heights = new Map<string, number>();
const HEIGHTS_LIMIT = 100;

function cachedHeight(source: string): number {
  return heights.get(source) ?? 200;
}

function rememberHeight(source: string, height: number) {
  heights.delete(source);
  heights.set(source, height);
  if (heights.size > HEIGHTS_LIMIT) {
    const oldest = heights.keys().next().value;
    if (oldest !== undefined) heights.delete(oldest);
  }
}

export function HtmlPreview({
  source,
  className,
  title = "HTML preview",
  autoHeight = true,
  fill = false,
  annotate = false,
  onAnnotate,
}: {
  source: string;
  className?: string;
  title?: string;
  autoHeight?: boolean;
  fill?: boolean;
  annotate?: boolean;
  onAnnotate?: (target: HtmlAnnotation) => void;
}) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(() => cachedHeight(source));
  const [theme, setTheme] = useState(readTheme);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setHeight(cachedHeight(source));
  }, [source]);

  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(readTheme()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== ref.current?.contentWindow) return;
      const data = event.data as
        | ({ type?: string; height?: number } & Partial<HtmlAnnotation>)
        | null;
      if (data?.type === "nit-html-height" && typeof data.height === "number") {
        const next = Math.max(80, Math.min(1200, data.height));
        rememberHeight(source, next);
        setHeight(next);
        return;
      }
      if (data?.type !== "nit-annotate" || !annotate || !onAnnotate || !data.rect) return;
      const box = ref.current?.getBoundingClientRect();
      onAnnotate({
        selector: data.selector ?? "",
        tag: data.tag ?? "",
        text: data.text ?? "",
        table: data.table,
        rect: {
          ...data.rect,
          left: data.rect.left + (box?.left ?? 0),
          top: data.rect.top + (box?.top ?? 0),
        },
      });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [annotate, onAnnotate, source]);

  const doc = htmlDocument(source, theme.dark, theme.background);
  const extras = annotate ? RESIZE + ANNOTATE : RESIZE;
  const withExtras = doc.includes("</body>")
    ? doc.replace("</body>", `${extras}</body>`)
    : `${doc}${extras}`;

  return (
    <div
      className={cn(
        "row-sheen-preview relative w-full overflow-hidden rounded-lg border border-border",
        fill && "h-full",
        loaded ? "row-sheen-preview-ready" : "row-sheen-preview-loading",
        className,
      )}
    >
      {!loaded && <span aria-hidden="true" className="row-sheen-preview-scan" />}
      <span aria-hidden="true" className="row-sheen-preview-trace" />
      <iframe
        ref={ref}
        title={title}
        srcDoc={withExtras}
        sandbox="allow-scripts allow-forms allow-modals"
        referrerPolicy="no-referrer"
        onLoad={() => setLoaded(true)}
        style={{
          height: fill ? undefined : autoHeight ? height : undefined,
          background: theme.background,
        }}
        className={cn("row-sheen-preview-frame w-full border-0", fill && "h-full")}
      />
    </div>
  );
}
