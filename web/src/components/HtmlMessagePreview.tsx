import { useState } from "react";
import { Code2, Eye, EyeOff } from "lucide-react";
import { HtmlPreview } from "./HtmlPreview";
import { Button } from "./ui/button";

export function HtmlMessagePreview({ source: sourceText }: { source: string }) {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState(false);

  return (
    <div className="border-border bg-card/60 my-2 overflow-hidden rounded-lg border">
      <div className="flex items-center justify-between gap-2 px-2.5 py-1.5">
        <span className="text-muted-foreground inline-flex items-center gap-1.5 text-[11px]">
          <Code2 className="size-3.5" />
          HTML document
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="xs"
            onClick={() => {
              setSource((value) => !value);
              setOpen(false);
            }}
          >
            <Code2 />
            {source ? "Preview" : "Source"}
          </Button>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => {
              setOpen((value) => !value);
              setSource(false);
            }}
          >
            {open ? <EyeOff /> : <Eye />}
            {open ? "Hide" : "Preview"}
          </Button>
        </div>
      </div>
      {source && (
        <pre className="border-border scrollbar-thin max-h-80 overflow-auto border-t p-3 font-mono text-[11px] whitespace-pre-wrap">
          {sourceText}
        </pre>
      )}
      {open && !source && (
        <div className="border-border border-t">
          <HtmlPreview source={sourceText} className="h-96" title="Sandboxed HTML message preview" />
          <p className="text-muted-foreground border-border border-t px-2.5 py-1.5 text-[10px]">
            Sandboxed iframe. No same-origin access.
          </p>
        </div>
      )}
    </div>
  );
}
