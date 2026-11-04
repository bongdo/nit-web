import { useState } from "react";
import { Check, Copy, Eye, EyeOff } from "lucide-react";
import { copyText } from "../lib/clipboard";
import { isHtmlLanguage } from "../lib/html";
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
  const [preview, setPreview] = useState(false);
  const html = isHtmlLanguage(language);

  const onCopy = async () => {
    if (await copyText(code)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <div className={cn("border-border bg-card my-4 overflow-hidden rounded-lg border", className)}>
      <div className="border-border bg-muted/40 flex items-center justify-between gap-2 border-b px-2.5 py-1.5">
        <span className="text-muted-foreground truncate font-mono text-[11px]">
          {language || "text"}
        </span>
        <div className="flex items-center gap-1">
          {html && (
            <Button variant="ghost" size="xs" onClick={() => setPreview((value) => !value)}>
              {preview ? <EyeOff /> : <Eye />}
              {preview ? "Source" : "Preview"}
            </Button>
          )}
          <Button variant="ghost" size="xs" onClick={onCopy}>
            {copied ? <Check /> : <Copy />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      </div>
      {preview ? (
        <HtmlPreview source={code} className="h-80" />
      ) : (
        <pre className="scrollbar-thin max-h-[32rem] overflow-auto p-3 font-mono text-[12.5px] leading-5">
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
}
