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
  const [browse, setBrowse] = useState<string | null>(initial);
  const [listing, setListing] = useState<FolderListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const listingRef = useRef<FolderListing | null>(null);

  const [path, setPath] = useState(initial ?? "");
  const [status, setStatus] = useState<PathStatus>("idle");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [active, setActive] = useState(0);
  const [activeMoved, setActiveMoved] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const panel = useModalFocus<HTMLDivElement>();
  const inputRef = useRef<HTMLInputElement>(null);
  const crumbsRef = useRef<HTMLDivElement>(null);
  const pressedBackdrop = useRef(false);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
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
        listingRef.current = data;
        setListing(data);
        setPath((value) => (value.trim() === "" ? data.path : value));
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
      setSuggestions([]);
      return;
    }
    const { dir, prefix } = splitPathInput(path);
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setStatus("checking");
      api
        .folders(dir, controller.signal)
        .then((data) => {
          if (controller.signal.aborted) return;
          const typed = normalizePath(path);
          const matches = matchFolders(data.dirs, prefix)
            .map((name) => joinPath(dir, name))
            .filter((candidate) => candidate !== typed);
          setSuggestions(matches.slice(0, 8));
          setActive(0);
          setActiveMoved(false);
          const exact = data.dirs.some((name) => isFolderName(name, prefix));
          setStatus(typed === data.path || exact ? "exists" : "missing");
        })
        .catch((cause) => {
          if (controller.signal.aborted) return;
          setSuggestions([]);
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
    setBrowse(clean);
    setPath(clean);
    setSuggestions([]);
    setSuggestOpen(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const pickTyped = () => {
    if (!isAbsolutePath(path)) {
      setStatus("relative");
      return;
    }
    if (status === "exists") {
      onPick(normalizePath(path));
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
        const suggestion = suggestions[active];
        if (suggestion) goTo(suggestion);
      });
  };

  const browseTyped = () => {
    if (status !== "exists") return;
    goTo(path);
  };

  const typed = isAbsolutePath(path) ? normalizePath(path) : "";
  const invalid = status === "relative" || status === "missing" || status === "error";
  const target =
    typed && (status === "exists" || typed === listing?.path)
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
            ? suggestions.length > 0
              ? "No exact match. Pick a suggestion."
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
        ) : listing.dirs.length === 0 ? (
          <p className="text-muted-foreground px-2 py-6 text-center text-xs">
            No subfolders. You can still use this folder.
          </p>
        ) : (
          listing.dirs.map((name) => {
            const directory = joinPath(listing.path, name);
            const project = known.get(directory);
            return (
              <button
                key={directory}
                type="button"
                onClick={() => goTo(directory)}
                className="group hover:bg-accent/60 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left"
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
                setPath(event.target.value);
                setSuggestOpen(true);
              }}
              onBlur={() => setSuggestOpen(false)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  if (suggestOpen) {
                    event.stopPropagation();
                    setSuggestOpen(false);
                  }
                  return;
                }
                if (event.key === "ArrowDown" && suggestions.length > 0) {
                  event.preventDefault();
                  setSuggestOpen(true);
                  setActive((value) => (value + 1) % suggestions.length);
                  setActiveMoved(true);
                  return;
                }
                if (event.key === "ArrowUp" && suggestions.length > 0) {
                  event.preventDefault();
                  setSuggestOpen(true);
                  setActive((value) => (value - 1 + suggestions.length) % suggestions.length);
                  setActiveMoved(true);
                  return;
                }
                if (event.key === "Tab") {
                  const suggestion = suggestions[active];
                  if (!suggestion) return;
                  event.preventDefault();
                  setPath(`${suggestion}/`);
                  setSuggestOpen(true);
                  return;
                }
                if (event.key === "Enter") {
                  event.preventDefault();
                  const suggestion = suggestOpen ? suggestions[active] : undefined;
                  if (suggestion && (activeMoved || status !== "exists")) onPick(suggestion);
                  else pickTyped();
                }
              }}
              placeholder="Jump to a path, e.g. /home/ubuntu/Projects"
              aria-label="Folder path"
              role="combobox"
              aria-controls="folder-suggestions"
              aria-autocomplete="list"
              aria-expanded={suggestOpen && suggestions.length > 0}
              aria-activedescendant={
                suggestOpen && suggestions[active] ? `folder-suggestion-${active}` : undefined
              }
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
            {suggestOpen && suggestions.length > 0 && (
              <div
                id="folder-suggestions"
                role="listbox"
                aria-label="Matching folders"
                className="overlay-popover border-border bg-popover absolute bottom-full left-0 z-20 mb-1 w-full rounded-lg border p-1 shadow-lg"
              >
                {suggestions.map((suggestion, index) => (
                  <button
                    key={suggestion}
                    id={`folder-suggestion-${index}`}
                    type="button"
                    role="option"
                    aria-selected={index === active}
                    tabIndex={-1}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => {
                      setActive(index);
                      setActiveMoved(true);
                    }}
                    onClick={() => goTo(suggestion)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left",
                      index === active && "bg-accent",
                    )}
                  >
                    <Folder className="text-muted-foreground size-3.5 shrink-0" />
                    <span className="truncate font-mono text-[11px]">{suggestion}</span>
                  </button>
                ))}
              </div>
            )}
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
          {statusText || "Enter picks the folder · Tab completes · ↑↓ browse matches"}
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
