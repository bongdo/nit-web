import { useEffect, useRef, useState } from "react";
import { htmlDocument } from "../lib/html";
import { cn } from "../lib/utils";

const RESIZE = `<script>
(() => {
  const send = () => parent.postMessage({ type: "nit-html-height", height: Math.ceil(document.documentElement.scrollHeight) }, "*");
  addEventListener("load", send);
  if (window.ResizeObserver) new ResizeObserver(send).observe(document.documentElement);
  setTimeout(send, 50);
})();
</script>`;

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
  const [height, setHeight] = useState(200);
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));

  useEffect(() => {
    const observer = new MutationObserver(() =>
      setDark(document.documentElement.classList.contains("dark")),
    );
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== ref.current?.contentWindow) return;
      const data = event.data as { type?: string; height?: number } | null;
      if (data?.type !== "nit-html-height" || typeof data.height !== "number") return;
      setHeight((current) => {
        const next = Math.max(80, Math.min(1200, data.height ?? current));
        return next === current ? current : next;
      });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const doc = htmlDocument(source, dark);
  const withResize = doc.includes("</body>")
    ? doc.replace("</body>", `${RESIZE}</body>`)
    : `${doc}${RESIZE}`;

  return (
    <iframe
      ref={ref}
      title={title}
      srcDoc={withResize}
      sandbox="allow-scripts allow-forms allow-modals"
      referrerPolicy="no-referrer"
      style={autoHeight ? { height } : undefined}
      className={cn("w-full border-0 bg-transparent", className)}
    />
  );
}
