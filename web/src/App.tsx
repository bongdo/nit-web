import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import { CircleAlert, Plus, RefreshCw, X } from "lucide-react";
import { api } from "./lib/api";
import type {
  Agent,
  Config,
  FormInfo,
  PermissionRequest,
  Health,
  Message,
  Model,
  ModelRef,
  Project,
  ReviewItem,
  ReviewQueue,
  Session,
  StreamEvent,
  UiState,
} from "./lib/types";
import {
  applyEvent,
  coalesceEvents,
  eventSessionID,
  lightenEvent,
  lightMessages,
  normalizeMessages,
  planRetry,
  retryDelay,
} from "./lib/stream";
import {
  mergeSnapshot,
  mergeTail,
  prependMessages,
  TranscriptCache,
} from "./lib/transcripts";
import {
  contextPercent,
  estimateCost,
  filterSessions,
  mergeRunningStates,
  sessionRunning,
} from "./lib/format";
import { questionFields } from "./lib/forms";
import {
  groupSessions,
  listedSessions,
  listedSubagents,
  mergeWaitingSessionIds,
  newlyRunning,
  nextSessionId,
  pollSessionIds,
  SCOPES,
  scopeSessions,
  splitByRecency,
  type Scope,
} from "./lib/sessions";
import { cn } from "./lib/utils";
import { instanceScopedKey } from "./lib/instances";
import { parseSnooze, pendingCount, snoozeItem, type SnoozeMap } from "./lib/review";
import type { TimeFormat } from "./lib/time";
import { useAttention } from "./hooks/useAttention";
import { useTheme, type Theme } from "./hooks/useTheme";
import { useEventStream } from "./hooks/useEventStream";
import { useSidebarSwipe } from "./hooks/useSidebarSwipe";
import { ChatView } from "./components/ChatView";
import { VARIANTS, type SceneSetting } from "./components/Scene";
import { Composer, type Attachment, type ComposerCommand } from "./components/Composer";
import { Header, SessionPill } from "./components/Header";
import { SubagentMenu } from "./components/SubagentMenu";
import { Sidebar } from "./components/Sidebar";
import { WorkspacePicker } from "./components/WorkspacePicker";
import { SettingsPanel } from "./components/SettingsPanel";
import { ReviewSheet, type ReviewAction } from "./components/ReviewSheet";
import { ThemePicker } from "./components/ThemePicker";
import { FormCard } from "./components/FormCard";
import { PermissionCard } from "./components/PermissionCard";
import { BootScreen, OfflineScreen } from "./components/StatusScreens";
import { Button } from "./components/ui/button";

const DOUBLE_ESCAPE_MS = 500;
const TAIL_LIMIT = 50;

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong";
}

const LEGACY_HIDDEN_KEY = "nit-gui.hidden";
const UI_MIGRATED_KEY = "nit-gui.ui-migrated";
const UI_PREFS_MIGRATED_KEY = "nit-gui.ui-prefs-migrated";

function reviewSnoozeKey(instance: string, workspace: string | null) {
  return `nit-gui.review-snooze.${instance}.${workspace ?? ""}`;
}

function eventSize(event: StreamEvent): number {
  try {
    return JSON.stringify(event.data ?? {}).length + 64;
  } catch {
    return 64;
  }
}

function isMessageStreamEvent(type: string): boolean {
  return (
    type.startsWith("session.text.") ||
    type.startsWith("session.reasoning.") ||
    type.startsWith("session.tool.") ||
    type === "session.step.started" ||
    type === "session.step.ended" ||
    type === "session.step.failed"
  );
}

function BottomDock({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const apply = () => {
      document.documentElement.style.setProperty("--dock", `${element.offsetHeight}px`);
    };
    const observer = new ResizeObserver(apply);
    observer.observe(element);
    apply();
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty("--dock");
    };
  }, []);

  return (
    <div
      ref={ref}
      className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-linear-to-t from-background via-background/90 to-transparent pt-8"
    >
      {children}
    </div>
  );
}

const COMMANDS: ComposerCommand[] = [
  { id: "new", label: "/new", description: "Start a new chat in this workspace" },
  { id: "dir", label: "/dir", description: "Switch workspace" },
  { id: "settings", label: "/settings", description: "Model, agent, theme" },
  { id: "instances", label: "/instances", description: "Switch OpenCode instance" },
  { id: "compact", label: "/compact", description: "Compact this session's context" },
  { id: "revert", label: "/revert", description: "Revert the last message and edit it" },
  { id: "fork", label: "/fork", description: "Fork before the last message" },
  { id: "retry", label: "/retry", description: "Repeat the last prompt" },
  { id: "theme", label: "/theme", description: "Pick a color theme" },
  { id: "clear", label: "/clear", description: "Clear the input" },
  { id: "help", label: "/help", description: "Show command help" },
];

export default function App({
  instance,
  defaultInstance,
  defaultDirectory,
  onOpenInstances,
}: {
  instance: string;
  defaultInstance: string;
  defaultDirectory?: string;
  onOpenInstances: () => void;
}) {
  const workspaceKey = instanceScopedKey("nit-gui.workspace", instance, defaultInstance);
  const sessionKey = instanceScopedKey("nit-gui.session", instance, defaultInstance);
  const recentKey = instanceScopedKey("nit-gui.recent", instance, defaultInstance);
  const { theme, setTheme } = useTheme();
  const [health, setHealth] = useState<Health | null>(null);
  const healthRef = useRef<Health | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [models, setModels] = useState<Model[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [workspace, setWorkspaceState] = useState<string | null>(() => {
    const stored = localStorage.getItem(workspaceKey);
    if (stored && stored.startsWith("/")) return stored;
    return defaultDirectory && defaultDirectory.startsWith("/") ? defaultDirectory : null;
  });
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const [recent, setRecent] = useState<string[]>(() => {
    try {
      const value = JSON.parse(localStorage.getItem(recentKey) ?? "[]");
      return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
    } catch {
      return [];
    }
  });
  const [scope, setScopeState] = useState<Scope>(() => {
    const value = localStorage.getItem("nit-gui.scope");
    return value === "mine" || value === "all" ? value : "directory";
  });
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("nit-gui.collapsed") === "1");
  const [sidebarMode, setSidebarMode] = useState<"button" | "hover" | "swipe">(() => {
    const stored = localStorage.getItem("nit-gui.sidebar-mode");
    return stored === "hover" || stored === "swipe" ? stored : "button";
  });
  const [sidebarHovered, setSidebarHovered] = useState(false);
  const setExpanded = useCallback((open: boolean) => {
    setCollapsed(!open);
    localStorage.setItem("nit-gui.collapsed", open ? "0" : "1");
  }, []);
  const swipeMode = sidebarMode === "swipe";
  const swipe = useSidebarSwipe(
    swipeMode ? "follow" : sidebarMode === "button" ? "trigger" : "off",
    setExpanded,
  );
  const [spellcheck, setSpellcheck] = useState(() => localStorage.getItem("nit-gui.spellcheck") !== "0");
  const [autofix, setAutofix] = useState(() => localStorage.getItem("nit-gui.autofix") !== "0");
  const [timeFormat, setTimeFormat] = useState<TimeFormat>(() =>
    localStorage.getItem("nit-gui.time-format") === "12h" ? "12h" : "24h",
  );
  const [showTime, setShowTime] = useState(
    () => localStorage.getItem("nit-gui.show-time") !== "0",
  );
  const [motion, setMotion] = useState<"animated" | "static">(() => {
    const stored = localStorage.getItem("nit-gui.motion");
    if (stored === "animated" || stored === "static") return stored;
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "static" : "animated";
  });
  useLayoutEffect(() => {
    document.documentElement.dataset.motion = motion;
  }, [motion]);
  const [background, setBackground] = useState<SceneSetting>(() => {
    const stored = localStorage.getItem("nit-gui.background");
    return stored === "random" || (VARIANTS as readonly string[]).includes(stored ?? "")
      ? (stored as SceneSetting)
      : "ripple";
  });
  const [sceneEpoch, setSceneEpoch] = useState(0);
  const [forms, setForms] = useState<FormInfo[]>([]);
  const [permissions, setPermissions] = useState<PermissionRequest[]>([]);
  const [backgroundWaitingIds, setBackgroundWaitingIds] = useState<Set<string>>(new Set());
  const [backgroundPermissionIds, setBackgroundPermissionIds] = useState<Set<string>>(new Set());
  const [failedIds, setFailedIds] = useState<Set<string>>(() => new Set());
  const [doneIds, setDoneIds] = useState<Set<string>>(() => new Set());
  const failedRef = useRef<Set<string>>(new Set());
  const [notifyOn, setNotifyOn] = useState(() => localStorage.getItem("nit-gui.notify") === "on");
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => new Set());
  const [showHidden, setShowHidden] = useState(false);
  const [showOlder, setShowOlder] = useState(false);
  const [ageNow, setAgeNow] = useState(() => Date.now());
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [selectedId, setSelectedIdState] = useState<string | null>(() =>
    localStorage.getItem(sessionKey),
  );
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const [messages, setMessages] = useState<Message[]>([]);
  const [subagents, setSubagents] = useState<Session[]>([]);
  const [composerDraft, setComposerDraft] = useState<{ text: string; id: number } | null>(null);
  const [composerInsert, setComposerInsert] = useState<{ text: string; id: number } | null>(null);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messageEpoch, setMessageEpoch] = useState(0);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const [runningIds, setRunningIds] = useState<Record<string, boolean>>({});
  const [compactingSessions, setCompactingSessions] = useState<Set<string>>(() => new Set());
  const [freshCompaction, setFreshCompaction] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [reviewQueue, setReviewQueue] = useState<ReviewQueue | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewNote, setReviewNote] = useState<{ path: string; text: string } | null>(null);
  const [reviewBase, setReviewBase] = useState<{ path: string; text: string } | null>(null);
  const [reviewBaseLoading, setReviewBaseLoading] = useState(false);
  const [reviewBusy, setReviewBusy] = useState<string | null>(null);
  const [reviewSent, setReviewSent] = useState<string | null>(null);
  const [reviewSnooze, setReviewSnooze] = useState<SnoozeMap>({});
  const curatorIds = useRef(new Map<string, string>());
  const [booting, setBooting] = useState(true);
  const [search, setSearch] = useState("");
  const searchQueryRef = useRef(search);
  searchQueryRef.current = search;
  const [sessionCursor, setSessionCursor] = useState<string | null>(null);
  const sessionCursorRef = useRef<string | null>(null);
  sessionCursorRef.current = sessionCursor;
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const sheetPull = useRef<number | null>(null);
  const [preferredModel, setPreferredModel] = useState<ModelRef | null>(null);
  const [preferredAgent, setPreferredAgent] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const refreshTimer = useRef<number | null>(null);
  const hoverTimer = useRef<number | null>(null);
  const firstStreamOpen = useRef(true);
  const runningEventsAt = useRef<Record<string, number>>({});
  const lastEscapeAt = useRef(0);
  const skipLoadRef = useRef<string | null>(null);
  const lastQueryRef = useRef(`${scope}|${workspace}|`);
  const streamQueue = useRef<StreamEvent[]>([]);
  const streamFrame = useRef<number | null>(null);
  const formsOwnerRef = useRef<string | null>(null);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const [transcriptCache] = useState(() => new TranscriptCache());
  const [messageLoads] = useState(() => new Set<string>());
  const questionIDs = useRef(new Set<string>());
  const retryTimers = useRef<Record<string, number>>({});
  const retryAttempts = useRef<Record<string, number>>({});
  const prefetchedAt = useRef(new Map<string, number>());
  const prefetching = useRef(new Set<string>());
  const prefetchTimer = useRef<number | null>(null);
  const prefetchRun = useRef({ active: false, again: false });
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const historyCursorRef = useRef(historyCursor);
  historyCursorRef.current = historyCursor;
  const earlierFailedRef = useRef(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [earlierFailed, setEarlierFailed] = useState(false);
  const loadingEarlierRef = useRef(false);
  const earlierRequest = useRef(0);
  const loadedIdRef = useRef<string | null>(null);
  const lastEpochRef = useRef(0);

  const applyUiState = useCallback((state: UiState) => {
    const hidden = new Set(Array.isArray(state.hidden) ? state.hidden : []);
    const done = new Set<string>();
    const failed = new Set<string>();
    for (const [id, status] of Object.entries(state.status ?? {})) {
      if (status === "done") done.add(id);
      else if (status === "failed") failed.add(id);
    }
    failedRef.current = failed;
    setHiddenIds(hidden);
    setDoneIds(done);
    setFailedIds(failed);
    if (state.model) setPreferredModel(state.model);
    if (state.agent) setPreferredAgent(state.agent);
  }, []);

  const loadUiState = useCallback(async () => {
    try {
      let state = await api.ui();
      if (localStorage.getItem(UI_MIGRATED_KEY) !== "1") {
        let legacy: string[] = [];
        try {
          const value = JSON.parse(localStorage.getItem(LEGACY_HIDDEN_KEY) ?? "[]");
          legacy = Array.isArray(value)
            ? value.filter((item) => typeof item === "string")
            : [];
        } catch {}
        if (legacy.length > 0 && state.hidden.length === 0) {
          await api.setHidden(legacy, true);
          state = { ...state, hidden: legacy };
        }
        localStorage.setItem(UI_MIGRATED_KEY, "1");
        localStorage.removeItem(LEGACY_HIDDEN_KEY);
      }
      if (localStorage.getItem(UI_PREFS_MIGRATED_KEY) !== "1") {
        if (!state.model) {
          try {
            const value = JSON.parse(localStorage.getItem("nit-gui.model") ?? "null");
            if (value && typeof value.id === "string" && typeof value.providerID === "string") {
              await api.setModel(value);
              state = { ...state, model: value };
            }
          } catch {}
        }
        if (!state.agent) {
          const legacy = localStorage.getItem("nit-gui.agent");
          if (legacy) {
            await api.setAgent(legacy);
            state = { ...state, agent: legacy };
          }
        }
        localStorage.setItem(UI_PREFS_MIGRATED_KEY, "1");
        localStorage.removeItem("nit-gui.model");
        localStorage.removeItem("nit-gui.agent");
      }
      applyUiState(state);
    } catch {}
  }, [applyUiState]);

  useEffect(() => {
    void loadUiState();
    const refresh = () => {
      if (!document.hidden) void loadUiState();
    };
    const timer = window.setInterval(refresh, 10_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [loadUiState]);

  useEffect(() => {
    const timer = window.setInterval(() => setAgeNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const runningIdsRef = useRef(runningIds);
  runningIdsRef.current = runningIds;
  const runningSeen = useRef<Record<string, boolean>>({});
  const backgroundWaitingRef = useRef(backgroundWaitingIds);
  backgroundWaitingRef.current = backgroundWaitingIds;
  const backgroundPermissionRef = useRef(backgroundPermissionIds);
  backgroundPermissionRef.current = backgroundPermissionIds;
  const permissionsOwnerRef = useRef<string | null>(null);
  const selectedSession = sessions.find((session) => session.id === selectedId) ?? null;
  const composerKey = selectedId ?? `new:${workspace ?? ""}`;
  const composerDraftKey =
    instance === defaultInstance ? composerKey : `${instance}:${composerKey}`;
  const parentSession = selectedSession?.parentID
    ? (sessions.find((session) => session.id === selectedSession.parentID) ?? null)
    : null;
  const lastUser = [...messages].reverse().find((message) => message.type === "user") ?? null;
  const currentModel = selectedSession?.model ?? preferredModel ?? config?.model ?? null;
  const currentAgent = selectedSession?.agent ?? preferredAgent ?? config?.agent ?? null;

  const isRunning = useCallback(
    (id: string) =>
      runningIds[id] ??
      sessionRunning(sessions.find((session) => session.id === id)),
    [runningIds, sessions],
  );
  const activePermissions = useMemo(
    () => (permissionsOwnerRef.current === selectedId ? permissions : []),
    [permissions, selectedId],
  );
  const waitingIds = useMemo(() => {
    const ids = mergeWaitingSessionIds(selectedId, forms, backgroundWaitingIds);
    for (const id of backgroundPermissionIds) ids.add(id);
    for (const permission of activePermissions) {
      if (permission.sessionID) ids.add(permission.sessionID);
      else if (selectedId) ids.add(selectedId);
    }
    return ids;
  }, [activePermissions, backgroundPermissionIds, backgroundWaitingIds, forms, selectedId]);
  const reviewCount = pendingCount(reviewQueue?.items ?? [], reviewSnooze, Date.now());
  const saveStatus = useCallback((id: string, status: "" | "done" | "failed") => {
    void api.setSessionStatus(id, status).catch((error) => setBanner(messageOf(error)));
  }, []);
  const saveHidden = useCallback((ids: string[], hidden: boolean) => {
    void api.setHidden(ids, hidden).catch((error) => setBanner(messageOf(error)));
  }, []);
  const markDone = useCallback(
    (id: string) => {
      if (failedRef.current.has(id)) return;
      setDoneIds((previous) => (previous.has(id) ? previous : new Set(previous).add(id)));
      saveStatus(id, "done");
    },
    [saveStatus],
  );
  const clearDone = useCallback(
    (id: string) => {
      setDoneIds((previous) => {
        if (!previous.has(id)) return previous;
        const next = new Set(previous);
        next.delete(id);
        return next;
      });
      if (!failedRef.current.has(id)) saveStatus(id, "");
    },
    [saveStatus],
  );
  const markFailed = useCallback(
    (id: string) => {
      failedRef.current.add(id);
      setFailedIds(new Set(failedRef.current));
      clearDone(id);
      saveStatus(id, "failed");
    },
    [clearDone, saveStatus],
  );
  const clearFailed = useCallback(
    (id: string) => {
      if (!failedRef.current.delete(id)) return;
      setFailedIds(new Set(failedRef.current));
      saveStatus(id, "");
    },
    [saveStatus],
  );
  const runningNow = selectedId ? isRunning(selectedId) : false;
  const modelInfo =
    models.find(
      (item) => item.id === currentModel?.id && item.providerID === currentModel?.providerID,
    ) ?? null;
  const sessionCost = selectedSession?.cost ?? 0;
  const lastAssistantTokens = [...messages]
    .reverse()
    .find((message) => message.type === "assistant" && message.tokens)?.tokens;
  const estimated = estimateCost(selectedSession?.tokens, modelInfo, lastAssistantTokens);
  const shownCost = sessionCost > 0 ? sessionCost : estimated;
  const shownContext = contextPercent(lastAssistantTokens, modelInfo);

  const flushStream = useCallback(() => {
    if (streamFrame.current !== null) {
      cancelAnimationFrame(streamFrame.current);
      streamFrame.current = null;
    }
    const events = coalesceEvents(streamQueue.current);
    streamQueue.current = [];
    if (events.length === 0) return;
    const current = selectedIdRef.current;
    setMessages((previous) =>
      events.reduce(
        (next, event) =>
          (event.data ?? {}).sessionID === current ? applyEvent(next, event) : next,
        previous,
      ),
    );
  }, []);

  const loadHealth = useCallback(async () => {
    try {
      const result = await api.health();
      setHealth(result);
      healthRef.current = result;
      return result;
    } catch (error) {
      const result: Health = { ok: false, error: messageOf(error) };
      setHealth(result);
      healthRef.current = result;
      return result;
    }
  }, []);

  const loadSessions = useCallback(async () => {
    const requestedAt = Date.now();
    const scopedDirectory = scopeRef.current === "directory" ? workspaceRef.current : null;
    const query = searchQueryRef.current.trim();
    try {
      // shortcut: children=true returns the newest 100 sessions, paginate when older subagents matter.
      const [list, nested] = await Promise.all([
        api.sessions(scopedDirectory ?? undefined, false, query || undefined),
        api
          .sessions(scopedDirectory ?? undefined, true, query || undefined)
          .catch(() => ({ data: [] as Session[], cursor: null })),
      ]);
      let data = list.data;
      const known = new Set(data.map((session) => session.id));
      for (const session of nested.data) {
        if (session.parentID && !known.has(session.id)) {
          data.push(session);
          known.add(session.id);
        }
      }
      const selected = selectedIdRef.current;
      if (selected && !data.some((session) => session.id === selected)) {
        try {
          data = [await api.session(selected), ...data];
        } catch {
          const keep = sessionsRef.current.find((session) => session.id === selected);
          if (keep) data = [keep, ...data];
        }
      }
      const cursor = nested.cursor?.next ?? null;
      sessionCursorRef.current = cursor;
      setSessionCursor(cursor);
      setSessions(data);
      setRunningIds((previous) =>
        mergeRunningStates(previous, data, runningEventsAt.current, requestedAt),
      );
    } catch (error) {
      setBanner(messageOf(error));
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  const loadMoreSessions = useCallback(async () => {
    const cursor = sessionCursorRef.current;
    if (!cursor || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    const scopedDirectory = scopeRef.current === "directory" ? workspaceRef.current : null;
    const query = searchQueryRef.current.trim();
    try {
      const page = await api.sessions(
        scopedDirectory ?? undefined,
        true,
        query || undefined,
        cursor,
      );
      setSessions((previous) => {
        const known = new Set(previous.map((session) => session.id));
        const add = page.data.filter((session) => !known.has(session.id));
        return add.length > 0 ? [...previous, ...add] : previous;
      });
      const next = page.cursor?.next ?? null;
      sessionCursorRef.current = next;
      setSessionCursor(next);
    } catch (error) {
      setBanner(messageOf(error));
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, []);

  const prefetchTranscripts = useCallback(
    async function run(list: Session[]) {
      if (prefetchRun.current.active) {
        prefetchRun.current.again = true;
        return;
      }
      prefetchRun.current.active = true;
      try {
        const queue = [...list].sort((a, b) => b.time.updated - a.time.updated);
        let next = 0;
        const worker = async () => {
          while (next < queue.length) {
            const session = queue[next++];
            if (selectedIdRef.current === session.id) continue;
            if (prefetching.current.has(session.id)) continue;
            const complete = transcriptCache.isComplete(session.id);
            if (complete && prefetchedAt.current.get(session.id) === session.time.updated) {
              continue;
            }
            if (runningIdsRef.current[session.id] ?? sessionRunning(session)) continue;
            prefetching.current.add(session.id);
            try {
              const page = await api.messages(session.id, { light: true });
              if (selectedIdRef.current === session.id) continue;
              const latest = sessionsRef.current.find((item) => item.id === session.id);
              if (
                !latest ||
                latest.time.updated !== session.time.updated ||
                (runningIdsRef.current[session.id] ?? sessionRunning(latest))
              ) {
                continue;
              }
              const full = normalizeMessages(page.data);
              const existing = transcriptCache.get(session.id);
              transcriptCache.set(session.id, {
                messages: lightMessages(
                  existing ? mergeSnapshot(full, existing.messages) : full,
                ),
                previous: page.previous ?? null,
                complete: page.previous === null,
              });
              prefetchedAt.current.set(session.id, session.time.updated);
            } catch {
              continue;
            } finally {
              prefetching.current.delete(session.id);
            }
          }
        };
        await Promise.all([worker(), worker()]);
      } finally {
        prefetchRun.current.active = false;
        if (prefetchRun.current.again) {
          prefetchRun.current.again = false;
          void run(sessionsRef.current);
        }
      }
    },
    [transcriptCache],
  );

  const loadProjects = useCallback(async () => {
    try {
      setProjects(await api.projects());
    } catch {
      setProjects([]);
    }
  }, []);

  const loadChildren = useCallback(async () => {
    const id = selectedIdRef.current;
    if (!id) {
      setSubagents([]);
      return;
    }
    try {
      setSubagents(await api.children(id));
    } catch {
      setSubagents([]);
    }
  }, []);

  const loadForms = useCallback(async () => {
    const id = selectedIdRef.current;
    if (!id) {
      formsOwnerRef.current = null;
      setForms([]);
      return;
    }
    try {
      const data = await api.forms(id);
      if (selectedIdRef.current !== id) return;
      formsOwnerRef.current = id;
      setForms(data);
    } catch {
      if (selectedIdRef.current !== id) return;
      formsOwnerRef.current = id;
      setForms([]);
    }
  }, []);

  const loadPermissions = useCallback(async () => {
    const id = selectedIdRef.current;
    if (!id) {
      permissionsOwnerRef.current = null;
      setPermissions([]);
      return;
    }
    try {
      const data = await api.permissions(id);
      if (selectedIdRef.current !== id) return;
      permissionsOwnerRef.current = id;
      setPermissions(data);
    } catch {
      if (selectedIdRef.current !== id) return;
      permissionsOwnerRef.current = id;
      setPermissions([]);
    }
  }, []);

  useEffect(() => {
    void loadChildren();
    void loadForms();
    void loadPermissions();
  }, [loadChildren, loadForms, loadPermissions, selectedId]);

  useEffect(() => {
    if (!selectedId || formsOwnerRef.current !== selectedId) return;
    const waiting = forms.length > 0;
    setBackgroundWaitingIds((previous) => {
      if (waiting === previous.has(selectedId)) return previous;
      const next = new Set(previous);
      if (waiting) next.add(selectedId);
      else next.delete(selectedId);
      return next;
    });
  }, [forms, selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    clearFailed(selectedId);
    clearDone(selectedId);
  }, [clearDone, clearFailed, selectedId]);

  useEffect(() => {
    let cancelled = false;
    let polling = false;

    const poll = async () => {
      if (cancelled || polling || !healthRef.current?.ok) return;
      const ids = pollSessionIds(
        sessionsRef.current,
        selectedIdRef.current,
        runningIdsRef.current,
        new Set([...backgroundWaitingRef.current, ...backgroundPermissionRef.current]),
      );
      if (ids.length === 0) return;
      polling = true;
      try {
        const results = await Promise.all(
          ids.map(async (id) => {
            const [formResult, permissionResult] = await Promise.allSettled([
              api.forms(id),
              api.permissions(id),
            ]);
            return {
              id,
              waiting:
                formResult.status === "fulfilled"
                  ? formResult.value.length > 0
                  : backgroundWaitingRef.current.has(id),
              permission:
                permissionResult.status === "fulfilled"
                  ? permissionResult.value.length > 0
                  : backgroundPermissionRef.current.has(id),
            };
          }),
        );
        if (cancelled) return;
        const known = new Set(sessionsRef.current.map((session) => session.id));
        setBackgroundWaitingIds((previous) => {
          const next = new Set(previous);
          for (const item of results) {
            if (item.id === selectedIdRef.current) continue;
            if (item.waiting) next.add(item.id);
            else next.delete(item.id);
          }
          for (const id of next) {
            if (!known.has(id)) next.delete(id);
          }
          if (next.size === previous.size && [...next].every((id) => previous.has(id))) {
            return previous;
          }
          return next;
        });
        setBackgroundPermissionIds((previous) => {
          const next = new Set(previous);
          for (const item of results) {
            if (item.id === selectedIdRef.current) continue;
            if (item.permission) next.add(item.id);
            else next.delete(item.id);
          }
          for (const id of next) {
            if (!known.has(id)) next.delete(id);
          }
          if (next.size === previous.size && [...next].every((id) => previous.has(id))) {
            return previous;
          }
          return next;
        });
      } finally {
        polling = false;
      }
    };

    const timer = window.setInterval(() => void poll(), 5_000);
    const onVisibility = () => {
      if (!document.hidden) void poll();
    };
    document.addEventListener("visibilitychange", onVisibility);
    void poll();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  useEffect(() => {
    const key = `${scope}|${workspace}|${search.trim()}`;
    if (lastQueryRef.current === key) return;
    const timer = window.setTimeout(
      () => {
        lastQueryRef.current = key;
        if (healthRef.current?.ok) void loadSessions();
      },
      search.trim() ? 250 : 0,
    );
    return () => window.clearTimeout(timer);
  }, [loadSessions, scope, search, workspace]);

  useEffect(() => {
    if (agents.length === 0 || scopeRef.current !== "mine") return;
    if (healthRef.current?.ok) void loadSessions();
  }, [agents, loadSessions]);

  const loadCatalog = useCallback(async () => {
    const [configResult, modelsResult, agentsResult] = await Promise.allSettled([
      api.config(),
      api.models(),
      api.agents(),
    ]);
    if (configResult.status === "fulfilled") {
      const value = configResult.value;
      setConfig(value);
      setPreferredModel((current) => current ?? value.model);
      setPreferredAgent((current) => current ?? value.agent);
    }
    if (modelsResult.status === "fulfilled") setModels(modelsResult.value);
    if (agentsResult.status === "fulfilled") setAgents(agentsResult.value);
  }, []);

  const retryConnection = useCallback(async () => {
    setBooting(true);
    setBanner(null);
    const result = await loadHealth();
    if (result.ok) {
      await Promise.all([loadCatalog(), loadProjects(), loadSessions()]);
    }
    setBooting(false);
  }, [loadCatalog, loadHealth, loadProjects, loadSessions]);

  useEffect(() => {
    void (async () => {
      const result = await loadHealth();
      if (result.ok) {
        await Promise.all([loadCatalog(), loadProjects(), loadSessions()]);
      } else {
        setSessionsLoading(false);
      }
      setBooting(false);
    })();
  }, [loadCatalog, loadHealth, loadProjects, loadSessions]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void (async () => {
        const wasOk = healthRef.current?.ok;
        const result = await loadHealth();
        if (result.ok && !wasOk) {
          void loadCatalog();
          void loadSessions();
        }
      })();
    }, 20_000);
    return () => window.clearInterval(timer);
  }, [loadCatalog, loadHealth, loadSessions]);

  useEffect(() => {
    if (!health?.ok || sessionsLoading || sessions.length === 0) return;
    if (selectedId && messagesLoading) return;
    if (prefetchTimer.current !== null) window.clearTimeout(prefetchTimer.current);
    prefetchTimer.current = window.setTimeout(() => {
      prefetchTimer.current = null;
      void prefetchTranscripts(sessions);
    }, 300);
    return () => {
      if (prefetchTimer.current !== null) {
        window.clearTimeout(prefetchTimer.current);
        prefetchTimer.current = null;
      }
    };
  }, [health?.ok, messagesLoading, prefetchTranscripts, selectedId, sessions, sessionsLoading]);

  useEffect(() => {
    if (streamFrame.current !== null) {
      cancelAnimationFrame(streamFrame.current);
      streamFrame.current = null;
    }
    streamQueue.current = [];
    if (!selectedId) {
      setMessages([]);
      setMessagesLoading(false);
      setTranscriptError(null);
      setHistoryCursor(null);
      setLoadingEarlier(false);
      loadingEarlierRef.current = false;
      loadedIdRef.current = null;
      return;
    }
    if (skipLoadRef.current === selectedId) {
      skipLoadRef.current = null;
      loadedIdRef.current = selectedId;
      return;
    }
    const force = lastEpochRef.current !== messageEpoch;
    lastEpochRef.current = messageEpoch;
    const cached = transcriptCache.get(selectedId);
    if (cached && !force) {
      setMessages(cached.messages);
      setHistoryCursor(cached.previous);
      setMessagesLoading(false);
      loadedIdRef.current = selectedId;
      return;
    }
    let cancelled = false;
    setMessagesLoading(!cached);
    setTranscriptError(null);
    const before = new Map(messagesRef.current.map((message) => [message.id, message]));
    api.messages(selectedId, { light: true })
      .then((page) => {
        if (cancelled) return;
        const tail = normalizeMessages(page.data);
        const previous = page.previous ?? null;
        const current = messagesRef.current;
        const cursor = previous;
        const changed = current.filter((message) => before.get(message.id) !== message);
        const base = force ? mergeTail(current, tail) : tail;
        const next = lightMessages(changed.length > 0 ? mergeTail(base, changed) : base);
        transcriptCache.set(selectedId, {
          messages: next,
          previous: cursor,
          complete: cursor === null,
        });
        earlierFailedRef.current = false;
        loadedIdRef.current = selectedId;
        setMessages(next);
        setHistoryCursor(cursor);
        const session = sessionsRef.current.find((item) => item.id === selectedId);
        if (session) {
          setRunningIds((previous) =>
            previous[selectedId] === undefined
              ? { ...previous, [selectedId]: sessionRunning(session) }
              : previous,
          );
        }
      })
      .catch((error) => {
        if (!cancelled) setTranscriptError(messageOf(error));
      })
      .finally(() => {
        if (!cancelled) setMessagesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, messageEpoch]);

  useEffect(() => {
    if (!freshCompaction) return;
    const timer = window.setTimeout(() => setFreshCompaction(null), 10_000);
    return () => window.clearTimeout(timer);
  }, [freshCompaction]);

  useEffect(() => {
    if (!selectedId || sessionsLoading) return;
    if (!sessions.some((session) => session.id === selectedId)) {
      transcriptCache.delete(selectedId);
      setSelectedIdState(null);
      localStorage.removeItem(sessionKey);
    }
  }, [sessions, sessionsLoading, selectedId]);

  useEffect(() => {
    if (!selectedId || showHidden || !hiddenIds.has(selectedId)) return;
    setSelectedIdState(null);
    localStorage.removeItem(sessionKey);
  }, [hiddenIds, selectedId, showHidden]);

  const saveCurrentTranscript = useCallback(() => {
    const current = selectedIdRef.current;
    if (!current || loadedIdRef.current !== current) return;
    const pending = coalesceEvents(streamQueue.current);
    const latest =
      pending.length === 0
        ? messagesRef.current
        : pending.reduce(
            (next, event) =>
              (event.data ?? {}).sessionID === current ? applyEvent(next, event) : next,
            messagesRef.current,
          );
    transcriptCache.set(current, {
      messages: lightMessages(latest),
      previous: historyCursorRef.current,
      complete: historyCursorRef.current === null && !earlierFailedRef.current,
    });
  }, [transcriptCache]);

  const selectSession = useCallback((id: string | null) => {
    const current = selectedIdRef.current;
    if (id !== current) {
      saveCurrentTranscript();
      const cached = id ? transcriptCache.get(id) : undefined;
      earlierRequest.current += 1;
      earlierFailedRef.current = false;
      setEarlierFailed(false);
      loadedIdRef.current = cached && id ? id : null;
      setMessages(cached?.messages ?? []);
      setHistoryCursor(cached?.previous ?? null);
      setMessagesLoading(Boolean(id) && !cached);
      setTranscriptError(null);
      setLoadingEarlier(false);
      loadingEarlierRef.current = false;
    }
    setSelectedIdState(id);
    if (id) localStorage.setItem(sessionKey, id);
    else localStorage.removeItem(sessionKey);
    setSidebarOpen(false);
    swipe.close();
  }, [saveCurrentTranscript, swipe.close]);

  const notifications =
    notifyOn && typeof Notification !== "undefined" && Notification.permission === "granted";

  const toggleNotify = useCallback(async () => {
    if (notifications) {
      localStorage.setItem("nit-gui.notify", "off");
      setNotifyOn(false);
      return;
    }
    if (typeof Notification === "undefined" || !window.isSecureContext) {
      setBanner("Desktop notifications need https:// or http://127.0.0.1");
      return;
    }
    const permission =
      Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (permission !== "granted") {
      setBanner("Notifications are blocked for this site");
      return;
    }
    localStorage.setItem("nit-gui.notify", "on");
    setNotifyOn(true);
  }, [notifications]);

  useAttention(waitingIds, { enabled: notifications, sessions, doneIds, onOpen: selectSession });

  const selectWorkspace = useCallback((directory: string) => {
    saveCurrentTranscript();
    const value = directory.trim().replace(/\/+$/, "") || "/";
    setWorkspaceState(value);
    localStorage.setItem(workspaceKey, value);
    setRecent((previous) => {
      const next = [value, ...previous.filter((item) => item !== value)].slice(0, 8);
      localStorage.setItem(recentKey, JSON.stringify(next));
      return next;
    });
    setScopeState("directory");
    localStorage.setItem("nit-gui.scope", "directory");
    setSelectedIdState(null);
    setSceneEpoch((epoch) => epoch + 1);
    localStorage.removeItem(sessionKey);
    loadedIdRef.current = null;
    setMessages([]);
    setMessagesLoading(false);
    setHistoryCursor(null);
    setLoadingEarlier(false);
    earlierRequest.current += 1;
    earlierFailedRef.current = false;
    setEarlierFailed(false);
    loadingEarlierRef.current = false;
    setPickerOpen(false);
  }, [saveCurrentTranscript]);

  const loadEarlier = useCallback(async () => {
    const id = selectedIdRef.current;
    const cursor = historyCursorRef.current;
    if (!id || !cursor || loadingEarlierRef.current) return;
    const token = ++earlierRequest.current;
    loadingEarlierRef.current = true;
    setLoadingEarlier(true);
    try {
      const page = await api.messages(id, { light: true, limit: TAIL_LIMIT, before: cursor });
      if (selectedIdRef.current !== id || token !== earlierRequest.current) return;
      const older = lightMessages(normalizeMessages(page.data));
      const previous = page.previous ?? null;
      const current = messagesRef.current;
      const next = prependMessages(current, older);
      if (older.length === 0 || next.length === current.length || previous === cursor) {
        earlierFailedRef.current = false;
        setEarlierFailed(false);
        historyCursorRef.current = null;
        setHistoryCursor(null);
        return;
      }
      earlierFailedRef.current = false;
      setEarlierFailed(false);
      historyCursorRef.current = previous;
      setHistoryCursor(previous);
      setMessages(next);
    } catch (error) {
      if (selectedIdRef.current !== id || token !== earlierRequest.current) return;
      earlierFailedRef.current = true;
      setEarlierFailed(true);
      setBanner(messageOf(error));
    } finally {
      if (token === earlierRequest.current) {
        loadingEarlierRef.current = false;
        setLoadingEarlier(false);
      }
    }
  }, []);

  const loadMessage = useCallback(async (messageID: string) => {
    const id = selectedIdRef.current;
    if (!id) return;
    const key = `${id}|${messageID}`;
    if (messageLoads.has(key)) return;
    messageLoads.add(key);
    const before = messagesRef.current.find((message) => message.id === messageID);
    try {
      const full = await api.message(id, messageID);
      if (selectedIdRef.current !== id) return;
      if (messagesRef.current.find((message) => message.id === messageID) !== before) return;
      setMessages((current) =>
        current.map((message) => (message.id === messageID ? full : message)),
      );
    } catch (error) {
      setBanner(messageOf(error));
    } finally {
      messageLoads.delete(key);
    }
  }, [messageLoads]);

  const changeScope = useCallback((next: Scope) => {
    setScopeState(next);
    localStorage.setItem("nit-gui.scope", next);
  }, []);

  const newChat = useCallback(() => {
    selectSession(null);
    setSceneEpoch((epoch) => epoch + 1);
    setSidebarOpen(false);
    if (!workspaceRef.current) setPickerOpen(true);
  }, [selectSession]);

  const toggleSidebar = useCallback(() => {
    if (sidebarMode === "swipe") {
      swipe.toggle();
      return;
    }
    setCollapsed((current) => {
      const next = !current;
      localStorage.setItem("nit-gui.collapsed", next ? "1" : "0");
      return next;
    });
  }, [sidebarMode, swipe.toggle]);

  const openHoverSidebar = useCallback(() => {
    if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
    setSidebarHovered(true);
  }, []);

  const closeHoverSidebar = useCallback(() => {
    if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => {
      hoverTimer.current = null;
      setSidebarHovered(false);
    }, 240);
  }, []);

  const sessionAndChildren = useCallback((id: string) => {
    const ids = [id];
    for (let index = 0; index < ids.length; index += 1) {
      for (const session of sessionsRef.current) {
        if (session.parentID === ids[index]) ids.push(session.id);
      }
    }
    return ids;
  }, []);

  const hideSession = useCallback(
    (id: string) => {
      const ids = sessionAndChildren(id);
      setHiddenIds((current) => {
        const next = new Set(current);
        for (const item of ids) next.add(item);
        return next;
      });
      saveHidden(ids, true);
      if (selectedIdRef.current && ids.includes(selectedIdRef.current)) selectSession(null);
    },
    [saveHidden, selectSession, sessionAndChildren],
  );

  const unhideSession = useCallback(
    (id: string) => {
      const ids = sessionAndChildren(id);
      setHiddenIds((current) => {
        const next = new Set(current);
        for (const item of ids) next.delete(item);
        return next;
      });
      saveHidden(ids, false);
    },
    [saveHidden, sessionAndChildren],
  );

  useEffect(() => {
    for (const id of newlyRunning(sessions, runningIds, runningSeen.current)) {
      if (hiddenIds.has(id)) unhideSession(id);
    }
  }, [hiddenIds, runningIds, sessions, unhideSession]);

  const deleteSession = useCallback(
    async (id: string) => {
      if (!window.confirm("Delete this chat? This cannot be undone.")) return;
      setBanner(null);
      try {
        await api.deleteSession(id);
        transcriptCache.delete(id);
        setSessions((current) => current.filter((item) => item.id !== id));
        setHiddenIds((current) => {
          if (!current.has(id)) return current;
          const next = new Set(current);
          next.delete(id);
          return next;
        });
        setDoneIds((current) => {
          if (!current.has(id)) return current;
          const next = new Set(current);
          next.delete(id);
          return next;
        });
        failedRef.current.delete(id);
        setFailedIds(new Set(failedRef.current));
        void api.removeSessionState(id).catch((error) => setBanner(messageOf(error)));
        if (selectedIdRef.current === id) {
          loadedIdRef.current = null;
          selectSession(null);
        }
        void loadSessions();
      } catch (error) {
        setBanner(messageOf(error));
      }
    },
    [loadSessions, selectSession],
  );

  const scheduleSessionsRefresh = useCallback(() => {
    if (refreshTimer.current !== null) return;
    refreshTimer.current = window.setTimeout(() => {
      refreshTimer.current = null;
      void loadSessions();
      void loadChildren();
      void loadForms();
    }, 500);
  }, [loadChildren, loadForms, loadSessions]);

  const reloadSelected = useCallback(() => {
    if (!selectedIdRef.current) return;
    earlierRequest.current += 1;
    earlierFailedRef.current = false;
    setEarlierFailed(false);
    loadingEarlierRef.current = false;
    setLoadingEarlier(false);
    setMessageEpoch((value) => value + 1);
  }, []);

  const markCompacting = useCallback((sessionID: string) => {
    setCompactingSessions((previous) => {
      if (previous.has(sessionID)) return previous;
      const next = new Set(previous);
      next.add(sessionID);
      return next;
    });
  }, []);

  const clearCompacting = useCallback((sessionID: string) => {
    setCompactingSessions((previous) => {
      if (!previous.has(sessionID)) return previous;
      const next = new Set(previous);
      next.delete(sessionID);
      return next;
    });
  }, []);

  const clearRetry = useCallback((sessionID: string) => {
    const timer = retryTimers.current[sessionID];
    if (timer !== undefined) {
      window.clearTimeout(timer);
      delete retryTimers.current[sessionID];
    }
    delete retryAttempts.current[sessionID];
  }, []);

  const scheduleRetry = useCallback(
    (sessionID: string, plan: NonNullable<ReturnType<typeof planRetry>>, start = 1) => {
      clearRetry(sessionID);
      const run = (attempt: number) => {
        const delay = retryDelay(attempt, plan.retryAfterMs);
        retryAttempts.current[sessionID] = attempt;
        setBanner(
          `Upstream overloaded — retrying ${attempt > 1 ? `(${attempt}) ` : ""}in ${Math.ceil(delay / 1000)}s…`,
        );
        retryTimers.current[sessionID] = window.setTimeout(async () => {
          delete retryTimers.current[sessionID];
          try {
            await api.prompt(sessionID, plan.text, plan.files, undefined, plan.id);
            delete retryAttempts.current[sessionID];
            setBanner(null);
          } catch {
            run(attempt + 1);
          }
        }, delay);
      };
      run(start);
    },
    [clearRetry],
  );

  useEffect(() => {
    return () => {
      for (const timer of Object.values(retryTimers.current)) window.clearTimeout(timer);
      retryTimers.current = {};
    };
  }, []);

  const openPicker = useCallback(() => setPickerOpen(true), []);
  const closePicker = useCallback(() => setPickerOpen(false), []);
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const openTheme = useCallback(() => setThemeOpen(true), []);
  const closeTheme = useCallback(() => setThemeOpen(false), []);
  const changeTheme = useCallback(
    (next: Theme) => {
      if (next === theme) return;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (motion !== "animated" || reduce || !document.startViewTransition) {
        setTheme(next);
        return;
      }
      document.startViewTransition(() => {
        flushSync(() => setTheme(next));
      });
    },
    [motion, setTheme, theme],
  );
  const openSidebar = useCallback(() => setSidebarOpen(true), []);
  const toggleHidden = useCallback(() => setShowHidden((value) => !value), []);
  const clearComposerDraft = useCallback(() => setComposerDraft(null), []);
  const clearComposerInsert = useCallback(() => setComposerInsert(null), []);
  const finishForm = useCallback(() => {
    setForms((current) => current.slice(1));
    reloadSelected();
  }, [reloadSelected]);
  const finishPermission = useCallback(() => {
    setPermissions((current) => current.slice(1));
    void loadPermissions();
  }, [loadPermissions]);

  const onEvent = (event: StreamEvent) => {
    const data = event.data ?? {};
    const sessionID = eventSessionID(event);
    const toolID = typeof data.id === "string" ? data.id : "";
    if (toolID && data.name === "question") questionIDs.current.add(toolID);

    if (sessionID) {
      if (event.type === "session.execution.started") {
        runningEventsAt.current[sessionID] = Date.now();
        setRunningIds((previous) => ({ ...previous, [sessionID]: true }));
        clearFailed(sessionID);
        clearDone(sessionID);
        clearRetry(sessionID);
        setBanner(null);
      }
      if (event.type === "session.execution.succeeded") {
        clearRetry(sessionID);
      }
      if (
        event.type === "session.idle" ||
        event.type === "session.execution.succeeded" ||
        event.type === "session.execution.failed" ||
        event.type === "session.execution.interrupted"
      ) {
        runningEventsAt.current[sessionID] = Date.now();
        setRunningIds((previous) => ({ ...previous, [sessionID]: false }));
        clearCompacting(sessionID);
      }
      if (event.type === "session.execution.failed") {
        const known =
          sessionID === selectedIdRef.current
            ? messagesRef.current
            : (transcriptCache.get(sessionID)?.messages ?? []);
        const plan = planRetry(
          known,
          data.error as Message["error"] | undefined,
          (retryAttempts.current[sessionID] ?? 0) + 1,
        );
        if (plan) {
          clearFailed(sessionID);
          clearDone(sessionID);
          scheduleRetry(sessionID, plan);
        } else {
          markFailed(sessionID);
        }
      }
      if (event.type === "session.compaction.failed") {
        markFailed(sessionID);
      }
      if (
        (event.type === "session.idle" || event.type === "session.execution.succeeded") &&
        !failedRef.current.has(sessionID) &&
        retryAttempts.current[sessionID] === undefined
      ) {
        markDone(sessionID);
      }
      if (event.type === "session.compaction.started") {
        markCompacting(sessionID);
      }
      if (event.type === "session.compaction.ended") {
        clearCompacting(sessionID);
        setFreshCompaction(sessionID);
        if (sessionID === selectedIdRef.current) reloadSelected();
      }
      if (event.type === "session.compaction.failed") {
        clearCompacting(sessionID);
        if (sessionID === selectedIdRef.current) {
          const reason = typeof data.reason === "string" ? data.reason : "";
          const failure = data.error as { message?: unknown } | undefined;
          if (reason === "manual" && typeof failure?.message === "string") {
            setBanner(failure.message);
          }
          reloadSelected();
        }
      }
      if (event.type === "session.usage.updated") {
        setSessions((previous) =>
          previous.map((session) =>
            session.id === sessionID
              ? {
                  ...session,
                  cost: typeof data.cost === "number" ? data.cost : session.cost,
                  tokens:
                    data.tokens && typeof data.tokens === "object"
                      ? (data.tokens as Session["tokens"])
                      : session.tokens,
                }
              : session,
          ),
        );
      }
    }

    if (sessionID === selectedIdRef.current && event.type.startsWith("form.")) {
      void loadForms();
    }
    if (sessionID === selectedIdRef.current && event.type.startsWith("permission.")) {
      void loadPermissions();
    }

    if (sessionID === selectedIdRef.current) {
      if (isMessageStreamEvent(event.type)) {
        streamQueue.current.push(event);
        if (streamFrame.current === null) {
          streamFrame.current = requestAnimationFrame(flushStream);
        }
      }
      if (
        event.type === "session.idle" ||
        event.type === "session.execution.succeeded" ||
        event.type === "session.execution.failed" ||
        event.type === "session.execution.interrupted"
      ) {
        flushStream();
        reloadSelected();
      }
    } else if (sessionID && isMessageStreamEvent(event.type)) {
      const cached = transcriptCache.get(sessionID);
      if (cached) {
        const light = lightenEvent(event, cached.messages, questionIDs.current);
        if (light) {
          transcriptCache.update(
            sessionID,
            applyEvent(cached.messages, light),
            eventSize(light),
          );
        }
      }
    }

    if (event.type === "session.deleted" && sessionID) {
      transcriptCache.delete(sessionID);
      setHiddenIds((current) => {
        if (!current.has(sessionID)) return current;
        const next = new Set(current);
        next.delete(sessionID);
        return next;
      });
      setDoneIds((current) => {
        if (!current.has(sessionID)) return current;
        const next = new Set(current);
        next.delete(sessionID);
        return next;
      });
      failedRef.current.delete(sessionID);
      setFailedIds(new Set(failedRef.current));
      void api.removeSessionState(sessionID).catch(() => {});
    }

    if (
      event.type === "session.created" ||
      event.type === "session.renamed" ||
      event.type === "session.deleted" ||
      event.type === "session.archived" ||
      event.type === "session.unarchived" ||
      event.type === "session.moved" ||
      event.type === "session.forked" ||
      event.type === "session.metadata.updated" ||
      event.type === "session.model.selected" ||
      event.type === "session.agent.selected" ||
      event.type.startsWith("session.execution.") ||
      event.type === "session.idle"
    ) {
      scheduleSessionsRefresh();
    }
  };

  const onStreamOpen = () => {
    if (firstStreamOpen.current) {
      firstStreamOpen.current = false;
      return;
    }
    transcriptCache.clear();
    void loadSessions();
    void loadChildren();
    void loadForms();
    void loadPermissions();
    reloadSelected();
  };

  const streamStatus = useEventStream(onEvent, onStreamOpen, instance);

  const send = useCallback(
    async (text: string, attachments: Attachment[] = [], delivery?: "queue" | "steer") => {
      setBanner(null);
      const files = attachments
        .filter((item) => item.path)
        .map((item) => ({ uri: `file://${item.path}`, name: item.name }));
      let id = selectedIdRef.current;
      let createdSession = false;
      if (!id) {
        const directory = workspaceRef.current;
        if (!directory) {
          setPickerOpen(true);
          throw new Error("Choose a workspace first.");
        }
        try {
          const session = await api.createSession({
            directory,
            agent: currentAgent ?? undefined,
            model: currentModel,
          });
          id = session.id;
          createdSession = true;
          skipLoadRef.current = session.id;
          setSessions((previous) => [
            session,
            ...previous.filter((item) => item.id !== session.id),
          ]);
          setRunningIds((previous) => ({ ...previous, [session.id]: false }));
          setSidebarOpen(false);
        } catch (error) {
          setBanner(messageOf(error));
          throw error;
        }
      }
      if (!id) throw new Error("Session was not created.");
      const sessionId = id;
      clearRetry(sessionId);
      const optimistic: Message = {
        id: `local-${Date.now()}`,
        type: "user",
        time: { created: Date.now() },
        text,
        ...(files.length > 0 ? { files } : {}),
      };
      setMessages((previous) => [...previous, optimistic]);
      runningEventsAt.current[sessionId] = Date.now();
      setRunningIds((previous) => ({ ...previous, [sessionId]: true }));
      try {
        const admitted = (await api.prompt(sessionId, text, files, delivery)) as {
          data?: { id?: string };
        };
        if (createdSession) {
          setSelectedIdState(sessionId);
          localStorage.setItem(sessionKey, sessionId);
          loadedIdRef.current = sessionId;
          setHistoryCursor(null);
          setLoadingEarlier(false);
          loadingEarlierRef.current = false;
        }
        const messageID = admitted?.data?.id;
        if (messageID) {
          setMessages((current) =>
            current.map((item) => (item.id === optimistic.id ? { ...item, id: messageID } : item)),
          );
        }
      } catch (error) {
        setMessages((current) => current.filter((item) => item.id !== optimistic.id));
        setRunningIds((previous) => ({ ...previous, [sessionId]: false }));
        setBanner(messageOf(error));
        throw error;
      }
    },
    [currentAgent, currentModel, sessionKey, clearRetry],
  );

  const stop = useCallback(async () => {
    const id = selectedIdRef.current;
    if (!id) return;
    try {
      await api.interrupt(id);
    } catch (error) {
      setBanner(messageOf(error));
    } finally {
      runningEventsAt.current[id] = Date.now();
      setRunningIds((previous) => ({ ...previous, [id]: false }));
    }
  }, []);

  const changeModel = useCallback(
    async (model: ModelRef) => {
      setPreferredModel(model);
      void api.setModel(model).catch((error) => setBanner(messageOf(error)));
      const session = selectedSession;
      if (!session) return;
      setSessions((previous) =>
        previous.map((item) => (item.id === session.id ? { ...item, model } : item)),
      );
      try {
        await api.switchModel(session.id, model);
      } catch (error) {
        setBanner(messageOf(error));
        void loadSessions();
      }
    },
    [loadSessions, selectedSession],
  );

  const changeAgent = useCallback(
    async (agent: string) => {
      setPreferredAgent(agent);
      void api.setAgent(agent).catch((error) => setBanner(messageOf(error)));
      const session = selectedSession;
      if (!session) return;
      setSessions((previous) =>
        previous.map((item) => (item.id === session.id ? { ...item, agent } : item)),
      );
      try {
        await api.switchAgent(session.id, agent);
      } catch (error) {
        setBanner(messageOf(error));
        void loadSessions();
      }
    },
    [loadSessions, selectedSession],
  );

  const loadReview = useCallback(async () => {
    if (!workspace) {
      setReviewQueue(null);
      return;
    }
    try {
      setReviewQueue(await api.review(workspace));
    } catch {
      setReviewQueue(null);
    }
  }, [workspace]);

  useEffect(() => {
    setReviewSnooze(parseSnooze(localStorage.getItem(reviewSnoozeKey(instance, workspace))));
    setReviewNote(null);
    setReviewBase(null);
  }, [instance, workspace]);

  useEffect(() => {
    void loadReview();
    const refresh = () => {
      if (!document.hidden) void loadReview();
    };
    const timer = window.setInterval(refresh, 10_000);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [loadReview]);

  const ensureCurator = useCallback(async () => {
    if (!workspace) throw new Error("Choose a workspace first");
    const known = curatorIds.current.get(workspace);
    if (known) return known;
    const found = sessions.find(
      (session) =>
        session.agent === "curator" &&
        !session.parentID &&
        session.location?.directory === workspace,
    );
    if (found) {
      curatorIds.current.set(workspace, found.id);
      return found.id;
    }
    const created = await api.createSession({
      directory: workspace,
      title: "Review",
      agent: "curator",
    });
    curatorIds.current.set(workspace, created.id);
    setSessions((previous) => [created, ...previous.filter((item) => item.id !== created.id)]);
    return created.id;
  }, [workspace, sessions, setSessions]);

  const reviewAction = useCallback(
    async (item: ReviewItem, action: ReviewAction, text?: string) => {
      if (!workspace) return;
      if (action === "later") {
        const next = snoozeItem(reviewSnooze, item.id, Date.now());
        setReviewSnooze(next);
        localStorage.setItem(reviewSnoozeKey(instance, workspace), JSON.stringify(next));
        return;
      }
      const note = item.note ? ` ${item.note}` : "";
      const prompt =
        action === "accept"
          ? `Принято ${item.id}. Запиши формулировку в${note}. Поставь заметке статус «принято», обнови docs/review/queue.json (status accepted) и предложение в docs/proposals. Покажи, что изменил.`
          : item.kind === "feature"
            ? `Не работает ${item.id}: ${text}. Создай баг-задачу через tasks new с этими словами и --source${note}. Выставь пункту в queue.json status rejected.`
            : `Не так, ${item.id}: ${text}. Переформулируй только этот пункт и обнови docs/review/queue.json (status proposed). В vault не пиши.`;
      setReviewBusy(item.id);
      setReviewSent(null);
      try {
        const sessionID = await ensureCurator();
        await api.prompt(sessionID, prompt);
        setReviewSent(item.id);
        window.setTimeout(() => void loadReview(), 5_000);
      } catch (error) {
        setBanner(messageOf(error));
      } finally {
        setReviewBusy(null);
      }
    },
    [workspace, instance, reviewSnooze, ensureCurator, loadReview],
  );

  const openReviewNote = useCallback(
    async (item: ReviewItem) => {
      if (!workspace || !item.note) return;
      if (reviewNote?.path === item.note) {
        setReviewNote(null);
        return;
      }
      try {
        setReviewNote(await api.doc(workspace, item.note));
      } catch (error) {
        setBanner(messageOf(error));
      }
    },
    [workspace, reviewNote],
  );

  const loadReviewBase = useCallback(async () => {
    if (!workspace) return;
    setReviewBaseLoading(true);
    try {
      setReviewBase(await api.doc(workspace, "vault/index.md"));
    } catch {
      setReviewBase(null);
    } finally {
      setReviewBaseLoading(false);
    }
  }, [workspace]);

  const previousUser = useCallback(
    (message: Message): Message | null => {
      if (message.type === "user") return message;
      const index = messages.findIndex((item) => item.id === message.id);
      for (let cursor = index; cursor >= 0; cursor -= 1) {
        if (messages[cursor]?.type === "user") return messages[cursor];
      }
      return null;
    },
    [messages],
  );

  const revertAt = useCallback(
    async (message: Message) => {
      const session = selectedSession;
      const target = previousUser(message);
      if (!session || !target) return;
      if (runningNow) {
        setBanner("Stop the run first.");
        return;
      }
      setBanner(null);
      try {
        await api.revert(session.id, target.id);
        setMessages((current) => {
          const index = current.findIndex((item) => item.id === target.id);
          return index >= 0 ? current.slice(0, index) : current;
        });
        setComposerDraft({ text: target.text ?? "", id: Date.now() });
        reloadSelected();
        void loadSessions();
        void loadChildren();
      } catch (error) {
        setBanner(messageOf(error));
      }
    },
    [loadChildren, loadSessions, previousUser, reloadSelected, runningNow, selectedSession],
  );

  const forkAt = useCallback(
    async (message: Message) => {
      const session = selectedSession;
      const target = previousUser(message);
      if (!session) return;
      setBanner(null);
      try {
        const forked = await api.fork(session.id, target?.id);
        setSessions((previous) => [forked, ...previous.filter((item) => item.id !== forked.id)]);
        selectSession(forked.id);
      } catch (error) {
        setBanner(messageOf(error));
      }
    },
    [previousUser, selectSession, selectedSession],
  );

  const revertRef = useRef(revertAt);
  revertRef.current = revertAt;
  const forkRef = useRef(forkAt);
  forkRef.current = forkAt;
  const revertMessage = useCallback(
    (message: Message) => revertRef.current(message),
    [],
  );
  const forkMessage = useCallback((message: Message) => forkRef.current(message), []);

  const compactSession = useCallback(async () => {
    const id = selectedIdRef.current;
    if (!id) return;
    setBanner(null);
    try {
      await api.compact(id);
      void loadSessions();
    } catch (error) {
      setBanner(messageOf(error));
    }
  }, [loadSessions]);

  const retryLast = useCallback(async () => {
    const id = selectedIdRef.current;
    if (!id || !lastUser || runningNow) return;
    setBanner(null);
    runningEventsAt.current[id] = Date.now();
    setRunningIds((previous) => ({ ...previous, [id]: true }));
    try {
      await api.prompt(id, lastUser.text ?? "");
    } catch (error) {
      setRunningIds((previous) => ({ ...previous, [id]: false }));
      setBanner(messageOf(error));
    }
  }, [lastUser, runningNow]);

  const revertLast = useCallback(() => {
    if (lastUser) void revertAt(lastUser);
  }, [lastUser, revertAt]);

  const openSubagent = useCallback(
    (session: Session) => {
      setSessions((previous) =>
        previous.some((item) => item.id === session.id) ? previous : [session, ...previous],
      );
      selectSession(session.id);
    },
    [selectSession],
  );

  const backToParent = useCallback(() => {
    if (parentSession) selectSession(parentSession.id);
  }, [parentSession, selectSession]);

  const runCommand = useCallback(
    (id: string) => {
      switch (id) {
        case "new":
          newChat();
          break;
        case "dir":
          setPickerOpen(true);
          break;
        case "settings":
          setSettingsOpen(true);
          break;
        case "instances":
          onOpenInstances();
          break;
        case "compact":
          void compactSession();
          break;
        case "revert":
          revertLast();
          break;
        case "fork":
          if (lastUser) void forkAt(lastUser);
          break;
        case "retry":
          void retryLast();
          break;
        case "theme":
          setThemeOpen(true);
          break;
        case "help":
          setBanner(
            "Commands: /new /dir /instances /compact /revert /fork /retry /theme /clear /help · Shortcuts: Alt+N new chat, Alt+J/K or Ctrl+Tab/Shift+Ctrl+Tab next/prev chat (Tab in a text field completes /commands and accepts the highlighted suggestion), Alt+←/→ this dir / mine / all, Ctrl/⌘K search",
          );
          break;
      }
    },
    [compactSession, forkAt, lastUser, newChat, onOpenInstances, retryLast, revertLast],
  );
  const runCommandRef = useRef(runCommand);
  runCommandRef.current = runCommand;
  const runCommandStable = useCallback((id: string) => runCommandRef.current(id), []);

  const scopedSessions = useMemo(
    () => listedSessions(scopeSessions(sessions, scope, agents), hiddenIds, showHidden),
    [agents, hiddenIds, scope, sessions, showHidden],
  );
  const ageKeepIds = useMemo(() => {
    const ids = new Set<string>();
    for (const session of scopedSessions) {
      if (session.id === selectedId || isRunning(session.id) || waitingIds.has(session.id)) {
        ids.add(session.id);
      }
    }
    const selected = sessions.find((session) => session.id === selectedId);
    if (selected?.parentID) ids.add(selected.parentID);
    for (const child of subagents) {
      if (child.parentID && (isRunning(child.id) || waitingIds.has(child.id))) {
        ids.add(child.parentID);
      }
    }
    return ids;
  }, [isRunning, scopedSessions, selectedId, sessions, subagents, waitingIds]);
  const { recent: recentSessions, older: olderSessions } = useMemo(
    () => splitByRecency(scopedSessions, ageKeepIds, ageNow),
    [ageKeepIds, ageNow, scopedSessions],
  );
  const visibleSessions = useMemo(
    () => (showOlder || search.trim() ? scopedSessions : recentSessions),
    [recentSessions, scopedSessions, search, showOlder],
  );
  const olderCount = search.trim() ? 0 : olderSessions.length;
  const hiddenCount = useMemo(
    () => sessions.filter((session) => hiddenIds.has(session.id)).length,
    [hiddenIds, sessions],
  );
  const cycleSessions = useMemo(
    () =>
      groupSessions(filterSessions(visibleSessions, search), waitingIds).map(
        (row) => row.session,
      ),
    [search, visibleSessions, waitingIds],
  );
  const visibleSubagents = useMemo(() => {
    const parentIds = new Set(visibleSessions.map((session) => session.id));
    return listedSubagents(sessions, parentIds, hiddenIds, showHidden);
  }, [hiddenIds, sessions, showHidden, visibleSessions]);

  const quoteSelection = useCallback((text: string) => {
    const clean = text.trim();
    if (clean) setComposerInsert({ text: clean, id: Date.now() });
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (mod && key === "k") {
        event.preventDefault();
        setSidebarOpen(true);
        swipe.open();
        window.setTimeout(() => searchRef.current?.focus(), 0);
        return;
      }
      if ((event.altKey && event.code === "KeyN") || (mod && key === "n")) {
        event.preventDefault();
        newChat();
        return;
      }
      if (event.altKey && (event.code === "KeyJ" || event.code === "KeyK")) {
        if (cycleSessions.length === 0) return;
        event.preventDefault();
        const step = event.code === "KeyJ" ? 1 : -1;
        const nextId = nextSessionId(cycleSessions, selectedIdRef.current, step);
        if (nextId) selectSession(nextId);
        return;
      }
      if (event.altKey && (event.code === "ArrowLeft" || event.code === "ArrowRight")) {
        event.preventDefault();
        const step = event.code === "ArrowRight" ? 1 : -1;
        const index = SCOPES.findIndex((item) => item.id === scopeRef.current);
        const next = SCOPES[(index + step + SCOPES.length) % SCOPES.length];
        if (next) changeScope(next.id);
        return;
      }
      if (event.ctrlKey && event.key === "Tab") {
        if (cycleSessions.length === 0) return;
        event.preventDefault();
        const nextId = nextSessionId(
          cycleSessions,
          selectedIdRef.current,
          event.shiftKey ? -1 : 1,
        );
        if (nextId) selectSession(nextId);
        return;
      }
      if (event.key === "Escape") {
        if (themeOpen) {
          if (!event.repeat) setThemeOpen(false);
          return;
        }
        if (settingsOpen) {
          if (!event.repeat) setSettingsOpen(false);
          return;
        }
        if (pickerOpen) {
          if (!event.repeat) setPickerOpen(false);
          return;
        }
        const id = selectedIdRef.current;
        if (!event.repeat && id && isRunning(id)) {
          const now = Date.now();
          if (now - lastEscapeAt.current < DOUBLE_ESCAPE_MS) {
            lastEscapeAt.current = 0;
            void stop();
          } else {
            lastEscapeAt.current = now;
          }
        }
        setSidebarOpen(false);
        setSidebarHovered(false);
        swipe.close();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    changeScope,
    cycleSessions,
    isRunning,
    newChat,
    selectSession,
    settingsOpen,
    stop,
    swipe.close,
    swipe.open,
    themeOpen,
    pickerOpen,
  ]);

  if (booting) return <BootScreen instance={instance} onSwitch={onOpenInstances} />;

  if (health && !health.ok && sessions.length === 0) {
    return (
      <OfflineScreen
        health={health}
        onRetry={() => void retryConnection()}
        instance={instance}
        onSwitch={onOpenInstances}
      />
    );
  }

  if (!workspace) {
    return (
      <WorkspacePicker
        projects={projects}
        motion={motion}
        variant={background}
        startDirectory={defaultDirectory}
        onPick={selectWorkspace}
        instance={instance}
        onInstances={onOpenInstances}
      />
    );
  }

  const offlineBanner = health && !health.ok ? "OpenCode service is offline." : null;
  const activeError = banner ?? offlineBanner;
  const running = selectedId ? isRunning(selectedId) : false;
  const hoverSidebar = sidebarMode === "hover";
  const questionForm = forms[0] && questionFields(forms[0]) ? forms[0] : null;

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      {hoverSidebar && (
        <button
          type="button"
          aria-label="Open chats"
          className="group fixed inset-y-0 left-0 z-20 hidden w-2 md:block"
          onPointerEnter={openHoverSidebar}
          onFocus={openHoverSidebar}
          onClick={openHoverSidebar}
        >
          <span className="bg-border/80 block h-full w-px opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100" />
        </button>
      )}
      <aside
        ref={swipe.ref}
        onPointerEnter={hoverSidebar ? openHoverSidebar : undefined}
        onPointerLeave={hoverSidebar ? closeHoverSidebar : undefined}
        aria-label="Chats"
        className={cn(
          "border-border bg-background fixed z-30 border-r",
          "max-md:inset-x-0 max-md:top-auto max-md:bottom-0 max-md:z-50 max-md:h-[min(82dvh,42rem)] max-md:w-full max-md:overscroll-contain max-md:rounded-t-2xl max-md:border-t max-md:border-r-0 max-md:pb-[env(safe-area-inset-bottom)] max-md:shadow-2xl",
          "md:inset-y-0 md:left-0 md:w-[280px]",
          "ease-[cubic-bezier(0.32,0.72,0,1)] transition-[translate,opacity,width] duration-300 motion-reduce:transition-none",
          sidebarOpen ? "max-md:translate-y-0" : "max-md:translate-y-full",
          hoverSidebar
            ? sidebarHovered
              ? "md:z-40 md:translate-x-0 md:opacity-100 md:shadow-2xl"
              : "md:z-40 md:-translate-x-full md:opacity-0 md:shadow-2xl"
            : swipeMode
              ? "swipe-sidebar md:z-40 md:shadow-2xl"
              : cn(
                  "md:static md:z-auto md:translate-x-0",
                  collapsed ? "md:w-0 md:overflow-hidden md:border-r-0" : "md:w-[280px] lg:w-[300px]",
                ),
        )}
      >
        <div className="flex h-full min-h-0 flex-col">
          <div className="flex shrink-0 justify-center pt-2 md:hidden">
            <span aria-hidden className="bg-border h-1 w-10 rounded-full" />
          </div>
          <div
            className={cn(
              "min-h-0 flex-1",
              hoverSidebar &&
                "transition-[translate] duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none",
              hoverSidebar && !sidebarHovered && "md:-translate-x-4",
            )}
          >
            <Sidebar
            sessions={visibleSessions}
            subagents={visibleSubagents}
            workspace={workspace}
            scope={scope}
            selectedId={selectedId}
            loading={sessionsLoading}
            health={health}
            streamStatus={streamStatus}
            theme={theme}
            search={search}
            searchRef={searchRef}
            hasMore={Boolean(sessionCursor)}
            loadingMore={loadingMore}
            onLoadMore={() => void loadMoreSessions()}
            olderCount={olderCount}
            onShowOlder={() => setShowOlder(true)}
            hiddenIds={hiddenIds}
            hiddenCount={hiddenCount}
            showHidden={showHidden}
            onSearch={setSearch}
            onScope={changeScope}
            onWorkspace={openPicker}
            onSelect={selectSession}
            onNew={newChat}
            onHide={hideSession}
            onUnhide={unhideSession}
            onDelete={deleteSession}
            onToggleHidden={toggleHidden}
            onSettings={() => {
              setSidebarOpen(false);
              openSettings();
            }}
            notify={notifications}
            onNotify={() => void toggleNotify()}
            onTheme={openTheme}
            instance={instance}
            onInstances={onOpenInstances}
            isRunning={isRunning}
            waitingIds={waitingIds}
            failedIds={failedIds}
            doneIds={doneIds}
            motion={motion}
            reviewCount={reviewCount}
            onReview={() => setReviewOpen(true)}
          />
          </div>
        </div>
      </aside>

      {sidebarOpen && (
        <button
          type="button"
          aria-label="Close sessions"
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <main className="relative flex min-w-0 flex-1 flex-col">
        <Header
          session={selectedSession}
          directory={workspace}
          models={models}
          model={currentModel}
          agent={currentAgent}
          contextPercent={shownContext}
          cost={shownCost}
          estimatedCost={sessionCost === 0 && estimated > 0}
          termURL={config?.termURL ?? "/term/"}
          peroURL={config?.peroURL ?? "/pero/"}
          transport={config?.transport ?? ""}
          collapsed={swipeMode ? !swipe.opened : collapsed}
          sidebarMode={sidebarMode}
          subagents={subagents}
          parent={parentSession}
          onOpenSubagent={openSubagent}
          onBack={backToParent}
          onToggleSidebar={toggleSidebar}
        />

        {activeError && (
          <div className="border-destructive/30 bg-destructive/10 text-destructive absolute inset-x-2.5 top-16 z-10 flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs shadow-sm backdrop-blur-xl">
            <CircleAlert className="size-3.5 shrink-0" />
            <span className="min-w-0 flex-1">{activeError}</span>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => {
                setBanner(null);
                if (offlineBanner) void retryConnection();
              }}
              aria-label="Dismiss error"
            >
              {offlineBanner ? <RefreshCw /> : <X />}
            </Button>
          </div>
        )}

        <ChatView
          session={selectedSession}
          messages={messages}
          loading={messagesLoading}
          running={running}
          compacting={compactingSessions.has(selectedSession?.id ?? "")}
          freshCompaction={freshCompaction === selectedSession?.id}
          error={transcriptError}
          models={models}
          agents={agents}
          projects={projects}
          recent={recent}
          workspace={workspace}
          peroURL={config?.peroURL ?? "/pero/"}
          motion={motion}
          background={background}
          sceneKey={sceneEpoch}
          timeFormat={timeFormat}
          showTime={showTime}
          onRetry={reloadSelected}
          onRevert={revertMessage}
          onFork={forkMessage}
          onQuote={quoteSelection}
          onPickWorkspace={selectWorkspace}
          onBrowseWorkspace={openPicker}
          hasEarlier={Boolean(historyCursor)}
          loadingEarlier={loadingEarlier}
          earlierFailed={earlierFailed}
          onLoadEarlier={loadEarlier}
          onLoadMessage={loadMessage}
        />

        <BottomDock>
          {activePermissions[0] && selectedSession && (
            <div className="pointer-events-auto">
              <PermissionCard
                permission={activePermissions[0]}
                sessionID={selectedSession.id}
                onDone={finishPermission}
                onError={setBanner}
              />
            </div>
          )}

          {forms[0] && selectedSession && !questionForm && (
            <div className="pointer-events-auto">
              <FormCard
                form={forms[0]}
                sessionID={selectedSession.id}
                onDone={finishForm}
                onError={setBanner}
              />
            </div>
          )}

          <div className="pointer-events-auto">
            <Composer
              key={composerKey}
              session={selectedSession}
              workspace={workspace}
              model={modelInfo}
              draftKey={composerDraftKey}
              instance={instance}
              disabled={!health?.ok}
              running={running}
              focusKey={selectedId}
              typingBlocked={settingsOpen || pickerOpen || themeOpen}
              drawerOpen={sidebarOpen}
              draft={composerDraft}
              insert={composerInsert}
              commands={COMMANDS}
              spellcheck={spellcheck}
              autofix={autofix}
              form={questionForm}
              onSend={send}
              onStop={stop}
              onCommand={runCommandStable}
              onError={setBanner}
              onFormDone={finishForm}
              onDraftApplied={clearComposerDraft}
              onInsertApplied={clearComposerInsert}
            />
          </div>

          <nav
            aria-label="Mobile navigation"
            className="border-border bg-background/95 pointer-events-auto flex items-center gap-1.5 border-t px-2 pt-1 pb-[env(safe-area-inset-bottom)] md:hidden"
          >
            <button
              type="button"
              onClick={openSidebar}
              onPointerDown={(event) => {
                sheetPull.current = event.clientY;
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerUp={(event) => {
                const start = sheetPull.current;
                sheetPull.current = null;
                if (start !== null && start - event.clientY > 28) openSidebar();
              }}
              onPointerCancel={() => {
                sheetPull.current = null;
              }}
              className="min-w-0 flex-1 touch-none text-left"
              aria-label="Open chats"
            >
              <SessionPill
                session={selectedSession}
                directory={workspace}
                models={models}
                model={currentModel}
                agent={currentAgent}
                contextPercent={shownContext}
                cost={shownCost}
                estimatedCost={sessionCost === 0 && estimated > 0}
                className="w-full"
              />
            </button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="size-11 shrink-0"
              onClick={newChat}
              disabled={!health?.ok}
              aria-label="New chat"
              title="New chat"
            >
              <Plus />
            </Button>
            <SubagentMenu
              sessions={subagents}
              onOpen={openSubagent}
              placement="up"
              className="size-11 shrink-0"
            />
          </nav>
        </BottomDock>
      </main>

      {pickerOpen && (
        <WorkspacePicker
          projects={projects}
          current={workspace}
          motion={motion}
          variant={background}
          startDirectory={defaultDirectory}
          onPick={selectWorkspace}
          onClose={closePicker}
          instance={instance}
          onInstances={onOpenInstances}
        />
      )}

      {settingsOpen && (
        <SettingsPanel
          models={models}
          agents={agents}
          model={currentModel}
          agent={currentAgent}
          theme={theme}
          directory={workspace}
          spellcheck={spellcheck}
          autofix={autofix}
          timeFormat={timeFormat}
          showTime={showTime}
          motion={motion}
          background={background}
          sidebarMode={sidebarMode}
          instance={instance}
          onModel={(model) => void changeModel(model)}
          onAgent={(agent) => void changeAgent(agent)}
          onTheme={changeTheme}
          onSidebar={(mode) => {
            setSidebarMode(mode);
            localStorage.setItem("nit-gui.sidebar-mode", mode);
            setSidebarHovered(false);
          }}
          onSpellcheck={(value) => {
            setSpellcheck(value);
            localStorage.setItem("nit-gui.spellcheck", value ? "1" : "0");
          }}
          onAutofix={(value) => {
            setAutofix(value);
            localStorage.setItem("nit-gui.autofix", value ? "1" : "0");
          }}
          onTimeFormat={(value) => {
            setTimeFormat(value);
            localStorage.setItem("nit-gui.time-format", value);
          }}
          onShowTime={(value) => {
            setShowTime(value);
            localStorage.setItem("nit-gui.show-time", value ? "1" : "0");
          }}
          onMotion={(value) => {
            setMotion(value);
            localStorage.setItem("nit-gui.motion", value);
          }}
          onBackground={(value) => {
            setBackground(value);
            localStorage.setItem("nit-gui.background", value);
          }}
          onInstances={onOpenInstances}
          onClose={closeSettings}
        />
      )}

      {reviewOpen && (
        <ReviewSheet
          items={reviewQueue?.items ?? []}
          snooze={reviewSnooze}
          now={Date.now()}
          busyId={reviewBusy}
          sentId={reviewSent}
          note={reviewNote}
          base={reviewBase}
          baseLoading={reviewBaseLoading}
          onClose={() => setReviewOpen(false)}
          onAction={(item, action, text) => void reviewAction(item, action, text)}
          onOpenNote={(item) => void openReviewNote(item)}
          onLoadBase={() => void loadReviewBase()}
        />
      )}

      {themeOpen && (
        <ThemePicker theme={theme} onPick={changeTheme} onClose={closeTheme} />
      )}
    </div>
  );
}
