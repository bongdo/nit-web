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
}: {
  source: string;
  className?: string;
  title?: string;
  autoHeight?: boolean;
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
      const data = event.data as { type?: string; height?: number } | null;
      if (data?.type !== "nit-html-height" || typeof data.height !== "number") return;
      const next = Math.max(80, Math.min(1200, data.height));
      rememberHeight(source, next);
      setHeight(next);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [source]);

  const doc = htmlDocument(source, theme.dark, theme.background);
  const withResize = doc.includes("</body>")
    ? doc.replace("</body>", `${RESIZE}</body>`)
    : `${doc}${RESIZE}`;

  return (
    <div
      className={cn(
        "row-sheen-preview relative w-full overflow-hidden rounded-lg border border-border",
        loaded ? "row-sheen-preview-ready" : "row-sheen-preview-loading",
        className,
      )}
    >
      {!loaded && <span aria-hidden="true" className="row-sheen-preview-scan" />}
      <span aria-hidden="true" className="row-sheen-preview-trace" />
      <iframe
        ref={ref}
        title={title}
        srcDoc={withResize}
        sandbox="allow-scripts allow-forms allow-modals"
        referrerPolicy="no-referrer"
        onLoad={() => setLoaded(true)}
        style={{ height: autoHeight ? height : undefined, background: theme.background }}
        className="row-sheen-preview-frame w-full border-0"
      />
    </div>
  );
}
