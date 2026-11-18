import { memo } from "react";
import { ChevronDown, ChevronUp, FileDiff } from "lucide-react";
import { basename } from "../lib/format";
import { peroHref, resolveFilePath } from "../lib/diff";
import type { EditedFile } from "../lib/types";
import { cn } from "../lib/utils";
import { FileLink } from "./FileLink";
import { Button } from "./ui/button";

function FileChip({
  file,
  base,
  cwd,
  agent,
  instance,
  sessionID,
}: {
  file: EditedFile;
  base: string;
  cwd?: string | null;
  agent?: string;
  instance?: string;
  sessionID?: string;
}) {
  const path = resolveFilePath(file.path, cwd);
  const pero = peroHref(base, path, file.lines, agent);
  return (
    <FileLink
      path={path}
      lines={file.lines}
      pero={pero}
      agent={agent}
      instance={instance}
      sessionID={sessionID}
      title={`View ${path}`}
      className="bg-muted text-muted-foreground hover:bg-accent hover:text-foreground inline-flex max-w-44 shrink-0 items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px]"
    >
      <span className="truncate">{basename(path)}</span>
      {file.additions ? <span className="text-success">+{file.additions}</span> : null}
      {file.deletions ? <span className="text-destructive">−{file.deletions}</span> : null}
    </FileLink>
  );
}

export const FileChips = memo(function FileChips({
  files,
  base,
  max = 3,
  cwd,
  agent,
  instance,
  sessionID,
  className,
}: {
  files: EditedFile[];
  base: string;
  max?: number;
  cwd?: string | null;
  agent?: string;
  instance?: string;
  sessionID?: string;
  className?: string;
}) {
  if (files.length === 0) return null;
  const shown = files.slice(0, max);
  const hidden = files.slice(max);
  return (
    <span className={cn("flex min-w-0 shrink-0 items-center gap-1 overflow-hidden", className)}>
      {shown.map((file) => (
        <FileChip
          key={file.path}
          file={file}
          base={base}
          cwd={cwd}
          agent={agent}
          instance={instance}
          sessionID={sessionID}
        />
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
  instance,
  sessionID,
  className,
}: {
  files: EditedFile[];
  base: string;
  cwd?: string | null;
  agent?: string;
  instance?: string;
  sessionID?: string;
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
        <FileChip
          key={file.path}
          file={file}
          base={base}
          cwd={cwd}
          agent={agent}
          instance={instance}
          sessionID={sessionID}
        />
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
