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
  const [height, setHeight] = useState(360);

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

  const document = htmlDocument(source);
  const withResize = document.includes("</body>")
    ? document.replace("</body>", `${RESIZE}</body>`)
    : `${document}${RESIZE}`;

  return (
    <iframe
      ref={ref}
      title={title}
      srcDoc={withResize}
      sandbox="allow-scripts allow-forms allow-modals"
      referrerPolicy="no-referrer"
      style={autoHeight ? { height } : undefined}
      className={cn("w-full border-0 bg-white", className)}
    />
  );
}
