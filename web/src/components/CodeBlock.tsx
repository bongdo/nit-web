import { useMemo, useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { copyText } from "../lib/clipboard";
import { previewableHtml } from "../lib/html";
import { tokenize, type SyntaxSpan } from "../lib/syntax";
import { cn } from "../lib/utils";
import { HtmlPreview } from "./HtmlPreview";
import { Button } from "./ui/button";

function highlight(code: string, spans: SyntaxSpan[]): ReactNode[] {
  const parts: ReactNode[] = [];
  let at = 0;
  for (const span of spans) {
    if (span.start > at) parts.push(code.slice(at, span.start));
    parts.push(
      <span key={span.start} className={`syn-${span.kind}`}>
        {code.slice(span.start, span.end)}
      </span>,
    );
    at = span.end;
  }
  if (at < code.length) parts.push(code.slice(at));
  return parts;
}

export function CodeBlock({
  code,
  language,
  className,
  streaming = false,
}: {
  code: string;
  language?: string;
  className?: string;
  streaming?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const spans = useMemo(() => (streaming ? null : tokenize(code)), [code, streaming]);
  const html = !streaming && previewableHtml(code, language);

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
        <code>{spans ? highlight(code, spans) : code}</code>
      </pre>
    </div>
  );
}
