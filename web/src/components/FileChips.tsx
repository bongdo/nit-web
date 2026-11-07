import { memo } from "react";
import { basename } from "../lib/format";
import { peroHref, type EditedFile } from "../lib/diff";
import { cn } from "../lib/utils";

export const FileChips = memo(function FileChips({
  files,
  base,
  max = 3,
  className,
}: {
  files: EditedFile[];
  base: string;
  max?: number;
  className?: string;
}) {
  if (files.length === 0) return null;
  const shown = files.slice(0, max);
  const hidden = files.slice(max);
  return (
    <span className={cn("flex min-w-0 shrink-0 items-center gap-1 overflow-hidden", className)}>
      {shown.map((file) => (
        <a
          key={file.path}
          href={peroHref(base, file.path)}
          target="_blank"
          rel="noreferrer"
          title={`Open ${file.path} in pero`}
          onClick={(event) => event.stopPropagation()}
          className="bg-muted text-muted-foreground hover:bg-accent hover:text-foreground inline-flex max-w-44 shrink-0 items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px]"
        >
          <span className="truncate">{basename(file.path)}</span>
          {file.additions ? <span className="text-success">+{file.additions}</span> : null}
          {file.deletions ? <span className="text-destructive">−{file.deletions}</span> : null}
        </a>
      ))}
      {hidden.length > 0 && (
        <span
          className="text-muted-foreground shrink-0 font-mono text-[10px]"
          title={hidden.map((file) => file.path).join("\n")}
        >
          +{hidden.length}
        </span>
      )}
    </span>
  );
});
