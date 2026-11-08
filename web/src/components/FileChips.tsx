import { memo, useState } from "react";
import { ChevronUp, FileDiff } from "lucide-react";
import { basename } from "../lib/format";
import { fileWindow, peroHref, type EditedFile } from "../lib/diff";
import { cn } from "../lib/utils";

function FileChip({ file, base }: { file: EditedFile; base: string }) {
  return (
    <a
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
  );
}

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
  const { visible, hidden } = fileWindow(files, max, false);
  return (
    <span className={cn("flex min-w-0 shrink-0 items-center gap-1 overflow-hidden", className)}>
      {visible.map((file) => (
        <FileChip key={file.path} file={file} base={base} />
      ))}
      {hidden > 0 && (
        <span
          className="text-muted-foreground shrink-0 font-mono text-[10px]"
          title={files
            .slice(visible.length)
            .map((file) => file.path)
            .join("\n")}
        >
          +{hidden}
        </span>
      )}
    </span>
  );
});

export function ChangedFiles({
  files,
  base,
  limit = 4,
  className,
}: {
  files: EditedFile[];
  base: string;
  limit?: number;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  if (files.length === 0) return null;
  const { visible, hidden } = fileWindow(files, limit, expanded);
  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      <FileDiff className="text-muted-foreground mr-0.5 size-3.5 shrink-0" aria-hidden />
      {visible.map((file) => (
        <FileChip key={file.path} file={file} base={base} />
      ))}
      {files.length > limit && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={expanded ? "Show fewer files" : `Show ${hidden} more files`}
          title={expanded ? "Show fewer files" : `Show ${hidden} more files`}
          onClick={() => setExpanded(!expanded)}
          className={cn(
            "inline-flex shrink-0 items-center gap-0.5 rounded px-1.5 py-0.5 font-mono text-[10px]",
            expanded
              ? "text-muted-foreground hover:text-foreground"
              : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          {expanded ? (
            <>
              <ChevronUp className="size-3" />
              Show less
            </>
          ) : (
            `+${hidden}`
          )}
        </button>
      )}
    </div>
  );
}
