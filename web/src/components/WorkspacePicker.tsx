import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderGit2,
  FolderOpen,
  Loader2,
  Server,
  X,
} from "lucide-react";
import type { FolderListing, Project } from "../lib/types";
import { basename, formatRelative } from "../lib/format";
import {
  isAbsolutePath,
  isFolderName,
  joinPath,
  matchFolders,
  normalizePath,
  parentPath,
  pathCrumbs,
  splitPathInput,
} from "../lib/paths";
import { ApiError, api } from "../lib/api";
import { useModalFocus } from "../hooks/useModalFocus";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Scene, type SceneSetting } from "./Scene";

export function workspaceOptions(projects: Project[], recent: string[]): string[] {
  return Array.from(new Set([...recent, ...projects.map((item) => item.canonical)]));
}

type PathStatus = "idle" | "relative" | "checking" | "exists" | "missing" | "error";

function messageOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Could not load folders";
}

export function WorkspacePicker({
  projects,
  current,
  startDirectory,
  motion = "animated",
  variant = "spotlight",
  onPick,
  onClose,
  instance,
  onInstances,
}: {
  projects: Project[];
  current?: string | null;
  startDirectory?: string;
  motion?: "animated" | "static";
  variant?: SceneSetting;
  onPick: (directory: string) => void;
  onClose?: () => void;
  instance?: string;
  onInstances?: () => void;
}) {
  const initial = [current, startDirectory].find((value) => value?.startsWith("/")) ?? null;
  const editable = (directory: string) => (directory === "/" ? "/" : `${directory}/`);
  const [browse, setBrowse] = useState<string | null>(initial);
  const [listing, setListing] = useState<FolderListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const listingRef = useRef<FolderListing | null>(null);

  const [path, setPath] = useState(initial ? editable(initial) : "");
  const [resolved, setResolved] = useState<string | null>(null);
  const [status, setStatus] = useState<PathStatus>("idle");
  const [active, setActive] = useState(-1);
  const [activeMoved, setActiveMoved] = useState(false);
  const panel = useModalFocus<HTMLDivElement>();
  const inputRef = useRef<HTMLInputElement>(null);
  const crumbsRef = useRef<HTMLDivElement>(null);
  const rowsRef = useRef<(HTMLButtonElement | null)[]>([]);
  const pressedBackdrop = useRef(false);
  const editing = useRef(false);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }, []);

  useEffect(() => {
    const crumbs = crumbsRef.current;
    if (crumbs) crumbs.scrollLeft = crumbs.scrollWidth;
  }, [browse]);

  const known = useMemo(
    () => new Map(projects.map((project) => [project.canonical, project])),
    [projects],
  );

  useEffect(() => {
    if (browse !== null && listingRef.current?.path === browse) return;
    const controller = new AbortController();
    setLoading(true);
    setListing(null);
    setBrowseError(null);
    api
      .folders(browse ?? undefined, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        listingRef.current = data;
        setListing(data);
        setPath((value) => (value.trim() === "" ? editable(data.path) : value));
        if (browse === null) setBrowse(data.path);
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        listingRef.current = null;
        setListing(null);
        setBrowseError(
          cause instanceof ApiError && cause.status === 404
            ? "This folder does not exist anymore."
            : messageOf(cause),
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [browse, reload]);

  useEffect(() => {
    if (!isAbsolutePath(path)) {
      setStatus(path.trim() ? "relative" : "idle");
      setResolved(null);
      return;
    }
    const { dir, prefix } = splitPathInput(path);
    const controller = new AbortController();
    setStatus("checking");
    const timer = window.setTimeout(() => {
      api
        .folders(dir, controller.signal)
        .then((data) => {
          if (controller.signal.aborted) return;
          if (editing.current) {
            setBrowse((current) => (current === data.path ? current : data.path));
          }
          const typed = normalizePath(path);
          const match = data.dirs.find((name) => isFolderName(name, prefix));
          const exact = typed === data.path ? typed : match ? joinPath(dir, match) : null;
          setResolved(exact);
          setStatus(exact ? "exists" : "missing");
        })
        .catch((cause) => {
          if (controller.signal.aborted) return;
          setResolved(null);
          setStatus(cause instanceof ApiError && cause.status === 404 ? "missing" : "error");
        });
    }, 150);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [path]);

  const goTo = (directory: string) => {
    const clean = normalizePath(directory);
    editing.current = false;
    setBrowse(clean);
    setPath(editable(clean));
    requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
  };

  const pickTyped = () => {
    if (!isAbsolutePath(path)) {
      setStatus("relative");
      return;
    }
    if (status === "exists") {
      onPick(resolved ?? normalizePath(path));
      return;
    }
    api
      .folders(normalizePath(path))
      .then((data) => onPick(data.path))
      .catch((cause) => {
        if (!(cause instanceof ApiError) || cause.status !== 404) {
          setStatus("error");
          return;
        }
        setStatus("missing");
      });
  };

  const browseTyped = () => {
    if (status !== "exists") return;
    goTo(resolved ?? path);
  };

  const typed = isAbsolutePath(path) ? normalizePath(path) : "";
  const pattern = isAbsolutePath(path) ? splitPathInput(path) : null;
  const matches =
    pattern && pattern.prefix && listing && pattern.dir === listing.path
      ? matchFolders(listing.dirs, pattern.prefix)
      : [];
  const usingFilter = matches.length > 0;
  const dirs = usingFilter ? matches : (listing?.dirs ?? []);
  const picked = active >= 0 ? dirs[active] : undefined;
  const highlighted = picked && listing ? joinPath(listing.path, picked) : null;
  const invalid = status === "relative" || status === "missing" || status === "error";

  useEffect(() => {
    setActive(usingFilter ? 0 : -1);
    setActiveMoved(false);
  }, [path, usingFilter, listing?.path]);

  useEffect(() => {
    if (active >= 0) rowsRef.current[active]?.scrollIntoView({ block: "nearest" });
  }, [active]);
  const target =
    status === "exists" && resolved
      ? resolved
      : typed && typed === listing?.path
        ? typed
        : path.trim() === ""
          ? (listing?.path ?? null)
          : null;
  const statusText =
    status === "relative"
      ? "Use an absolute path, starting with /."
      : status === "checking"
        ? "Checking the folder."
        : status === "exists"
          ? "Folder exists."
          : status === "missing"
            ? usingFilter
              ? "No exact match. Enter picks the highlighted folder."
              : "No such folder."
            : status === "error"
              ? "Cannot read this folder."
              : "";

  const body = (
    <div
      ref={panel}
      role={onClose ? "dialog" : undefined}
      aria-modal={onClose ? true : undefined}
      aria-label={onClose ? "Choose a workspace" : undefined}
      tabIndex={-1}
      onClick={onClose ? (event) => event.stopPropagation() : undefined}
      className="overlay-modal bg-background border-border relative flex max-h-[calc(100dvh-2rem)] w-full max-w-xl flex-col overflow-hidden rounded-xl border shadow-xl outline-none"
    >
      <div className="border-border flex items-center gap-2 border-b px-4 py-3">
        <Folder className="text-muted-foreground size-4" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">Choose a workspace</div>
          <div className="text-muted-foreground text-[11px]">
            Every chat is scoped to one directory for its lifetime.
          </div>
        </div>
        {onInstances && (
          <Button
            variant="ghost"
            size="sm"
            className="max-w-36 shrink-0"
            onClick={onInstances}
            title="OpenCode instances"
          >
            <Server className="size-3.5 shrink-0" />
            <span className="truncate">{instance || "Instances"}</span>
          </Button>
        )}
        {onClose && (
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
            <X />
          </Button>
        )}
      </div>

      <div className="border-border flex items-center gap-1 border-b px-2 py-1.5">
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => goTo(listing?.parent ?? parentPath(browse ?? "/"))}
          disabled={!browse || browse === "/"}
          title="Parent folder"
          aria-label="Parent folder"
        >
          <ArrowUp />
        </Button>
        <div
          ref={crumbsRef}
          className="scrollbar-thin flex min-w-0 flex-1 items-center overflow-x-auto whitespace-nowrap"
        >
          {pathCrumbs(browse ?? "/").map((crumb, index, all) => (
            <span key={crumb.path} className="flex shrink-0 items-center">
              {index > 0 && (
                <ChevronRight className="text-muted-foreground/50 size-3 shrink-0" aria-hidden />
              )}
              <button
                type="button"
                onClick={() => goTo(crumb.path)}
                aria-current={index === all.length - 1 ? "location" : undefined}
                className={cn(
                  "rounded px-1 py-0.5 font-mono text-[11px] hover:bg-accent",
                  index === all.length - 1
                    ? "text-foreground font-medium"
                    : "text-muted-foreground",
                )}
              >
                {crumb.label}
              </button>
            </span>
          ))}
        </div>
        {loading && <Loader2 className="text-muted-foreground size-3.5 shrink-0 animate-spin" />}
      </div>

      <div className="scrollbar-thin h-64 min-h-0 overflow-y-auto p-2">
        {browseError ? (
          <div className="px-2 py-8 text-center">
            <p className="text-[12px]">{browseError}</p>
            <div className="mt-3 flex justify-center gap-2">
              <Button size="sm" variant="secondary" onClick={() => setReload((value) => value + 1)}>
                Retry
              </Button>
              {browse && browse !== "/" && (
                <Button size="sm" onClick={() => goTo(parentPath(browse))}>
                  Go up
                </Button>
              )}
            </div>
          </div>
        ) : !listing ? (
          <div className="text-muted-foreground flex h-full items-center justify-center gap-2 text-xs">
            <Loader2 className="size-3.5 animate-spin" />
            Loading folders…
          </div>
        ) : dirs.length === 0 ? (
          <p className="text-muted-foreground px-2 py-6 text-center text-xs">
            No subfolders. You can still use this folder.
          </p>
        ) : (
          dirs.map((name, index) => {
            const directory = joinPath(listing.path, name);
            const project = known.get(directory);
            return (
              <button
                key={directory}
                ref={(element) => {
                  rowsRef.current[index] = element;
                }}
                type="button"
                onClick={() => goTo(directory)}
                aria-current={index === active ? "true" : undefined}
                className={cn(
                  "group hover:bg-accent/60 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left",
                  index === active && "bg-accent",
                )}
              >
                {project?.vcs ? (
                  <FolderGit2 className="text-muted-foreground size-4 shrink-0" />
                ) : (
                  <Folder className="text-muted-foreground size-4 shrink-0" />
                )}
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      "block truncate text-[13px] font-medium",
                      name.startsWith(".") && "text-muted-foreground",
                    )}
                  >
                    {name}
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
                <ChevronRight className="text-muted-foreground size-3.5 shrink-0 opacity-40 group-hover:opacity-100" />
              </button>
            );
          })
        )}
        {listing?.truncated && (
          <p className="text-muted-foreground px-2 py-2 text-center text-[10px]">
            Showing the first 1000 folders.
          </p>
        )}
      </div>

      <div className="border-border border-t px-3 pt-2.5 pb-2">
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Input
              ref={inputRef}
              value={path}
              onChange={(event) => {
                editing.current = true;
                setPath(event.target.value);
              }}
              onKeyDown={(event) => {
                if ((event.key === "ArrowDown" || event.key === "ArrowUp") && dirs.length > 0) {
                  event.preventDefault();
                  const step = event.key === "ArrowDown" ? 1 : -1;
                  setActive((value) =>
                    value < 0
                      ? step > 0
                        ? 0
                        : dirs.length - 1
                      : (value + step + dirs.length) % dirs.length,
                  );
                  setActiveMoved(true);
                  return;
                }
                if (event.key === "Enter") {
                  event.preventDefault();
                  if (highlighted && (activeMoved || status !== "exists")) onPick(highlighted);
                  else pickTyped();
                }
              }}
              placeholder="Jump to a path, e.g. /home/ubuntu/Projects"
              aria-label="Folder path"
              aria-describedby="folder-status"
              aria-invalid={invalid || undefined}
              title={statusText || undefined}
              className={cn(
                "h-8 pr-8 font-mono text-xs",
                invalid &&
                  "border-destructive focus-visible:border-destructive focus-visible:ring-destructive/20",
              )}
            />
            <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2">
              {status === "checking" ? (
                <Loader2 className="text-muted-foreground size-3.5 animate-spin" />
              ) : status === "exists" ? (
                <Check className="text-success size-3.5" />
              ) : invalid ? (
                <X className="text-destructive size-3.5" />
              ) : null}
            </span>
          </div>
          <Button
            variant="secondary"
            size="sm"
            disabled={status !== "exists"}
            onClick={browseTyped}
            title="Show this folder in the list"
          >
            Browse
          </Button>
          <Button
            size="sm"
            className="max-w-44 shrink-0"
            disabled={!target}
            onClick={() => target && onPick(target)}
            title={target ? `Use ${target}` : undefined}
          >
            <span className="truncate">{target ? `Use “${basename(target)}”` : "Use folder"}</span>
          </Button>
        </div>
        <p
          id="folder-status"
          role="status"
          aria-live="polite"
          className={cn(
            "mt-1.5 truncate text-[10px]",
            invalid ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {statusText || "↑↓ pick a folder · Enter uses it · click opens it"}
        </p>
      </div>
    </div>
  );

  if (onClose) {
    return (
      <div
        className="overlay-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        onPointerDown={(event) => {
          pressedBackdrop.current = event.target === event.currentTarget;
        }}
        onClick={() => {
          if (pressedBackdrop.current) onClose();
        }}
      >
        {body}
      </div>
    );
  }

  return (
    <div className="overlay-context bg-background relative flex h-full items-center justify-center overflow-hidden p-4">
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
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const known = new Map(projects.map((project) => [project.canonical, project]));
  const directories = workspaceOptions(projects, recent).filter(
    (directory) => directory !== current,
  );

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (open) menu.current?.querySelector<HTMLElement>("[role='menuitem']")?.focus();
  }, [open]);

  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>("[role='menuitem']"),
    );
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      items[(index + step + items.length) % items.length]?.focus();
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      items[event.key === "Home" ? 0 : items.length - 1]?.focus();
      return;
    }
    if (event.key === "Tab" || event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  };

  return (
    <div ref={root} className="relative inline-block max-w-full">
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Switch workspace (Alt+O)"
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
          ref={menu}
          role="menu"
          onKeyDown={onMenuKeyDown}
          className="overlay-popover border-border bg-popover absolute top-full left-1/2 z-40 mt-1 w-80 max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-lg border p-1 text-left shadow-lg"
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
                    tabIndex={-1}
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
            tabIndex={-1}
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
