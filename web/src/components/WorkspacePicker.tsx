import { useEffect, useRef, useState } from "react";
import { ChevronDown, Folder, FolderGit2, FolderOpen, X } from "lucide-react";
import type { Project } from "../lib/types";
import { basename, formatRelative } from "../lib/format";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Scene, type SceneSetting } from "./Scene";

export function workspaceOptions(projects: Project[], recent: string[]): string[] {
  return Array.from(new Set([...recent, ...projects.map((item) => item.canonical)]));
}

export function WorkspacePicker({
  projects,
  recent,
  current,
  motion = "animated",
  variant = "magnetic",
  onPick,
  onClose,
}: {
  projects: Project[];
  recent: string[];
  current?: string | null;
  motion?: "animated" | "static";
  variant?: SceneSetting;
  onPick: (directory: string) => void;
  onClose?: () => void;
}) {
  const [path, setPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const known = new Map(projects.map((project) => [project.canonical, project]));
  const directories = workspaceOptions(projects, recent);

  const submit = () => {
    const value = path.trim().replace(/\/+$/, "");
    if (!value.startsWith("/")) {
      setError("Use an absolute path.");
      return;
    }
    setError(null);
    onPick(value || "/");
  };

  const body = (
    <div className="bg-background border-border relative flex w-full max-w-lg flex-col overflow-hidden rounded-xl border shadow-xl">
      <div className="border-border flex items-center gap-2 border-b px-4 py-3">
        <Folder className="text-muted-foreground size-4" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">Choose a workspace</div>
          <div className="text-muted-foreground text-[11px]">
            Every chat is scoped to one directory for its lifetime.
          </div>
        </div>
        {onClose && (
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
            <X />
          </Button>
        )}
      </div>

      <div className="scrollbar-thin max-h-[50vh] min-h-0 overflow-y-auto p-2">
        {directories.length === 0 ? (
          <p className="text-muted-foreground px-2 py-6 text-center text-xs">
            No known projects yet. Enter a path below.
          </p>
        ) : (
          directories.map((directory) => {
            const project = known.get(directory);
            return (
              <button
                key={directory}
                type="button"
                onClick={() => onPick(directory)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left",
                  current === directory ? "bg-accent" : "hover:bg-accent/60",
                )}
              >
                {project?.vcs ? (
                  <FolderGit2 className="text-muted-foreground size-4 shrink-0" />
                ) : (
                  <Folder className="text-muted-foreground size-4 shrink-0" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{basename(directory)}</span>
                  <span className="text-muted-foreground block truncate font-mono text-[10px]">
                    {directory}
                  </span>
                </span>
                {project?.vcs && (
                  <span className="text-muted-foreground shrink-0 text-[10px]">{project.vcs}</span>
                )}
                {project?.time.active ? (
                  <span className="text-muted-foreground shrink-0 text-[10px]">
                    {formatRelative(project.time.active)}
                  </span>
                ) : null}
              </button>
            );
          })
        )}
      </div>

      <form
        className="border-border flex items-center gap-2 border-t px-3 py-3"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Input
          value={path}
          onChange={(event) => {
            setPath(event.target.value);
            setError(null);
          }}
          placeholder="/home/ubuntu/Projects/repo"
          aria-label="Workspace path"
          className="h-8 font-mono text-xs"
        />
        <Button type="submit" size="sm" disabled={!path.trim()}>
          Use path
        </Button>
      </form>
      {error && <p className="text-destructive px-4 pb-3 text-[11px]">{error}</p>}
    </div>
  );

  if (onClose) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
        {body}
      </div>
    );
  }

  return (
    <div className="bg-background relative flex h-full items-center justify-center overflow-hidden p-4">
      <Scene variant={variant} motion={motion} />
      {body}
    </div>
  );
}

export function WorkspaceMenu({
  projects,
  recent,
  current,
  onPick,
  onBrowse,
}: {
  projects: Project[];
  recent: string[];
  current: string;
  onPick: (directory: string) => void;
  onBrowse: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const known = new Map(projects.map((project) => [project.canonical, project]));
  const directories = workspaceOptions(projects, recent).filter(
    (directory) => directory !== current,
  );

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={root} className="relative inline-block max-w-full">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Switch workspace"
        className="text-muted-foreground hover:bg-accent hover:text-foreground mx-auto flex max-w-full items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[11px]"
      >
        <Folder className="size-3.5 shrink-0" />
        <span className="truncate">{current}</span>
        <ChevronDown
          className={cn("size-3 shrink-0 transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <div
          role="menu"
          className="border-border bg-popover absolute top-full left-1/2 z-40 mt-1 w-80 max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-lg border p-1 text-left shadow-lg"
        >
          <div className="text-muted-foreground px-2 py-1 text-[10px] font-medium tracking-wide uppercase">
            Recent
          </div>
          <div className="scrollbar-thin max-h-48 overflow-y-auto">
            {directories.length === 0 ? (
              <p className="text-muted-foreground px-2 py-3 text-center text-[11px]">
                No other workspaces yet.
              </p>
            ) : (
              directories.map((directory) => {
                const project = known.get(directory);
                return (
                  <button
                    key={directory}
                    role="menuitem"
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      onPick(directory);
                    }}
                    className="hover:bg-accent/60 flex w-full items-center gap-2 rounded px-2 py-1.5 text-left"
                  >
                    {project?.vcs ? (
                      <FolderGit2 className="text-muted-foreground size-3.5 shrink-0" />
                    ) : (
                      <Folder className="text-muted-foreground size-3.5 shrink-0" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-medium">
                        {basename(directory)}
                      </span>
                      <span className="text-muted-foreground block truncate font-mono text-[10px]">
                        {directory}
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
          <button
            role="menuitem"
            type="button"
            onClick={() => {
              setOpen(false);
              onBrowse();
            }}
            className="border-border hover:bg-accent/60 mt-1 flex w-full items-center gap-2 rounded border-t px-2 py-2 text-left text-[12px]"
          >
            <FolderOpen className="text-muted-foreground size-3.5 shrink-0" />
            Choose another folder…
          </button>
        </div>
      )}
    </div>
  );
}
