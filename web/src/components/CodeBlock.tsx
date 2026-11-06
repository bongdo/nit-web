import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { copyText } from "../lib/clipboard";
import { previewableHtml } from "../lib/html";
import { cn } from "../lib/utils";
import { HtmlPreview } from "./HtmlPreview";
import { Button } from "./ui/button";

export function CodeBlock({
  code,
  language,
  className,
}: {
  code: string;
  language?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const html = previewableHtml(code, language);

  if (html) {
    return <HtmlPreview source={code} autoHeight className={cn("my-3", className)} />;
  }

  const onCopy = async () => {
    if (await copyText(code)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <div className={cn("border-border bg-card my-4 overflow-hidden rounded-lg border", className)}>
      <div className="border-border bg-muted/40 flex items-center justify-between gap-2 border-b px-2.5 py-1.5">
        <span
          key={language || "text"}
          className="row-sheen-lang text-muted-foreground truncate font-mono text-[11px]"
        >
          {language || "text"}
        </span>
        <Button
          variant="ghost"
          size="xs"
          className={`row-sheen-copy${copied ? " row-sheen-copy-on" : ""}`}
          onClick={onCopy}
        >
          {copied ? <Check /> : <Copy />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </Button>
      </div>
      <pre className="scrollbar-thin max-h-[32rem] overflow-auto p-3 font-mono text-[12.5px] leading-5">
        <code>{code}</code>
      </pre>
    </div>
  );
}
