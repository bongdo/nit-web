import { memo } from "react";
import { ChevronDown, ChevronUp, FileDiff } from "lucide-react";
import { appLinkClick } from "../lib/appLink";
import { basename } from "../lib/format";
import { peroHref, resolveFilePath } from "../lib/diff";
import type { EditedFile } from "../lib/types";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";

function FileChip({
  file,
  base,
  cwd,
  agent,
}: {
  file: EditedFile;
  base: string;
  cwd?: string | null;
  agent?: string;
}) {
  const path = resolveFilePath(file.path, cwd);
  const href = peroHref(base, path, file.lines, agent);
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={`Open ${path} in pero`}
      onClick={(event) => {
        event.stopPropagation();
        appLinkClick({ app: "pero", path, lines: file.lines, agent }, href)(event);
      }}
      className="bg-muted text-muted-foreground hover:bg-accent hover:text-foreground inline-flex max-w-44 shrink-0 items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px]"
    >
      <span className="truncate">{basename(path)}</span>
      {file.additions ? <span className="text-success">+{file.additions}</span> : null}
      {file.deletions ? <span className="text-destructive">−{file.deletions}</span> : null}
    </a>
  );
}

export const FileChips = memo(function FileChips({
  files,
  base,
  max = 3,
  cwd,
  agent,
  className,
}: {
  files: EditedFile[];
  base: string;
  max?: number;
  cwd?: string | null;
  agent?: string;
  className?: string;
}) {
  if (files.length === 0) return null;
  const shown = files.slice(0, max);
  const hidden = files.slice(max);
  return (
    <span className={cn("flex min-w-0 shrink-0 items-center gap-1 overflow-hidden", className)}>
      {shown.map((file) => (
        <FileChip key={file.path} file={file} base={base} cwd={cwd} agent={agent} />
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

export function FileList({
  files,
  base,
  cwd,
  agent,
  className,
}: {
  files: EditedFile[];
  base: string;
  cwd?: string | null;
  agent?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "scrollbar-thin flex max-h-48 flex-wrap content-start items-center gap-1 overflow-y-auto",
        className,
      )}
    >
      {files.map((file) => (
        <FileChip key={file.path} file={file} base={base} cwd={cwd} agent={agent} />
      ))}
    </div>
  );
}

export function ChangedFilesButton({
  count,
  open,
  onClick,
  className,
}: {
  count: number;
  open: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <Button
      variant="ghost"
      size="xs"
      aria-expanded={open}
      onClick={onClick}
      className={cn("text-muted-foreground", open && "bg-accent text-foreground", className)}
    >
      <FileDiff />
      <span>
        {count} {count === 1 ? "file" : "files"}
      </span>
      {open ? <ChevronUp /> : <ChevronDown />}
    </Button>
  );
}
