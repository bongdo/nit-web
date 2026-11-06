import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CircleAlert, RefreshCw, X } from "lucide-react";
import { api } from "./lib/api";
import type {
  Agent,
  Config,
  FormInfo,
  Health,
  Message,
  Model,
  ModelRef,
  Project,
  Session,
  StreamEvent,
} from "./lib/types";
import { applyEvent, normalizeMessages } from "./lib/stream";
import {
  contextPercent,
  estimateCost,
  filterSessions,
  mergeRunningStates,
  sessionRunning,
} from "./lib/format";
import { questionField } from "./lib/forms";
import {
  groupSessions,
  mergeWaitingSessionIds,
  nextSessionId,
  pollSessionIds,
  scopeSessions,
  type Scope,
} from "./lib/sessions";
import { cn } from "./lib/utils";
import { useTheme } from "./hooks/useTheme";
import { useEventStream } from "./hooks/useEventStream";
import { ChatView } from "./components/ChatView";
import type { SceneSetting } from "./components/Scene";
import { Composer, type Attachment, type ComposerCommand } from "./components/Composer";
import { Header } from "./components/Header";
import { Sidebar } from "./components/Sidebar";
import { WorkspacePicker } from "./components/WorkspacePicker";
import { SettingsPanel } from "./components/SettingsPanel";
import { FormCard } from "./components/FormCard";
import { BootScreen, OfflineScreen } from "./components/StatusScreens";
import { Button } from "./components/ui/button";

const DOUBLE_ESCAPE_MS = 500;

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong";
}

function saveHidden(ids: Set<string>) {
  localStorage.setItem("nit-gui.hidden", JSON.stringify([...ids]));
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
  { id: "compact", label: "/compact", description: "Compact this session's context" },
  { id: "revert", label: "/revert", description: "Revert the last message and edit it" },
  { id: "fork", label: "/fork", description: "Fork before the last message" },
  { id: "retry", label: "/retry", description: "Repeat the last prompt" },
  { id: "theme", label: "/theme", description: "Cycle light, dark and system" },
  { id: "clear", label: "/clear", description: "Clear the input" },
  { id: "help", label: "/help", description: "Show command help" },
];

export default function App() {
  const { theme, setTheme, cycle } = useTheme();
  const [health, setHealth] = useState<Health | null>(null);
  const healthRef = useRef<Health | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [models, setModels] = useState<Model[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [workspace, setWorkspaceState] = useState<string | null>(() => {
    const stored = localStorage.getItem("nit-gui.workspace");
    return stored && stored.startsWith("/") ? stored : null;
  });
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const [recent, setRecent] = useState<string[]>(() => {
    try {
      const value = JSON.parse(localStorage.getItem("nit-gui.recent") ?? "[]");
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
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("nit-gui.collapsed") === "1");
  const [sidebarMode, setSidebarMode] = useState<"button" | "hover">(() =>
    localStorage.getItem("nit-gui.sidebar-mode") === "hover" ? "hover" : "button",
  );
  const [sidebarHovered, setSidebarHovered] = useState(false);
  const [dictationMode, setDictationMode] = useState<"fast" | "accurate">(() =>
    localStorage.getItem("nit-gui.dictation") === "accurate" ? "accurate" : "fast",
  );
  const [spellcheck, setSpellcheck] = useState(() => localStorage.getItem("nit-gui.spellcheck") !== "0");
  const [autofix, setAutofix] = useState(() => localStorage.getItem("nit-gui.autofix") !== "0");
  const [motion, setMotion] = useState<"animated" | "static">(() => {
    const stored = localStorage.getItem("nit-gui.motion");
    if (stored === "animated" || stored === "static") return stored;
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "static" : "animated";
  });
  const [background, setBackground] = useState<SceneSetting>(() => {
    const stored = localStorage.getItem("nit-gui.background");
    return stored === "magnetic" ||
      stored === "split" ||
      stored === "ripple" ||
      stored === "diagonal" ||
      stored === "random"
      ? stored
      : "magnetic";
  });
  const [forms, setForms] = useState<FormInfo[]>([]);
  const [backgroundWaitingIds, setBackgroundWaitingIds] = useState<Set<string>>(new Set());
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => {
    try {
      const value = JSON.parse(localStorage.getItem("nit-gui.hidden") ?? "[]");
      return new Set(Array.isArray(value) ? value.filter((item) => typeof item === "string") : []);
    } catch {
      return new Set();
    }
  });
  const [showHidden, setShowHidden] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [selectedId, setSelectedIdState] = useState<string | null>(() =>
    localStorage.getItem("nit-gui.session"),
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
  const [banner, setBanner] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);
  const [search, setSearch] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [preferredModel, setPreferredModel] = useState<ModelRef | null>(() => {
    try {
      const value = JSON.parse(localStorage.getItem("nit-gui.model") ?? "null");
      return value && typeof value.id === "string" && typeof value.providerID === "string"
        ? value
        : null;
    } catch {
      return null;
    }
  });
  const [preferredAgent, setPreferredAgent] = useState<string | null>(() =>
    localStorage.getItem("nit-gui.agent"),
  );
  const searchRef = useRef<HTMLInputElement>(null);
  const refreshTimer = useRef<number | null>(null);
  const hoverTimer = useRef<number | null>(null);
  const firstStreamOpen = useRef(true);
  const runningEventsAt = useRef<Record<string, number>>({});
  const lastEscapeAt = useRef(0);
  const skipLoadRef = useRef<string | null>(null);
  const lastQueryRef = useRef(`${scope}|${workspace}`);
  const streamQueue = useRef<StreamEvent[]>([]);
  const streamFrame = useRef<number | null>(null);
  const formsOwnerRef = useRef<string | null>(null);

  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const agentsRef = useRef(agents);
  agentsRef.current = agents;
  const runningIdsRef = useRef(runningIds);
  runningIdsRef.current = runningIds;
  const backgroundWaitingRef = useRef(backgroundWaitingIds);
  backgroundWaitingRef.current = backgroundWaitingIds;
  const selectedSession = sessions.find((session) => session.id === selectedId) ?? null;
  const composerKey = selectedId ?? `new:${workspace ?? ""}`;
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
  const waitingIds = useMemo(
    () => mergeWaitingSessionIds(selectedId, forms, backgroundWaitingIds),
    [backgroundWaitingIds, forms, selectedId],
  );
  const runningNow = selectedId ? isRunning(selectedId) : false;
  const modelInfo =
    models.find(
      (item) => item.id === currentModel?.id && item.providerID === currentModel?.providerID,
    ) ?? null;
  const sessionCost = selectedSession?.cost ?? 0;
  const estimated = estimateCost(selectedSession?.tokens, modelInfo);
  const shownCost = sessionCost > 0 ? sessionCost : estimated;
  const lastAssistantTokens = [...messages]
    .reverse()
    .find((message) => message.type === "assistant" && message.tokens)?.tokens;
  const shownContext = contextPercent(lastAssistantTokens, modelInfo);

  const flushStream = useCallback(() => {
    if (streamFrame.current !== null) {
      cancelAnimationFrame(streamFrame.current);
      streamFrame.current = null;
    }
    const events = streamQueue.current;
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
    try {
      const list = await api.sessions(scopedDirectory ?? undefined, scopeRef.current === "all");
      const data = scopeSessions(list.data, scopeRef.current, agentsRef.current);
      setSessions((previous) => {
        const keep = previous.find(
          (item) =>
            item.id === selectedIdRef.current &&
            item.parentID &&
            !data.some((session) => session.id === item.id),
        );
        return keep ? [keep, ...data] : data;
      });
      setRunningIds((previous) =>
        mergeRunningStates(previous, data, runningEventsAt.current, requestedAt),
      );
    } catch (error) {
      setBanner(messageOf(error));
    } finally {
      setSessionsLoading(false);
    }
  }, []);

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

  useEffect(() => {
    void loadChildren();
    void loadForms();
  }, [loadChildren, loadForms, selectedId]);

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
    let cancelled = false;
    let polling = false;

    const poll = async () => {
      if (cancelled || polling || document.hidden || !healthRef.current?.ok) return;
      const ids = pollSessionIds(
        sessionsRef.current,
        selectedIdRef.current,
        runningIdsRef.current,
        backgroundWaitingRef.current,
      );
      if (ids.length === 0) return;
      polling = true;
      try {
        const results = await Promise.all(
          ids.map(async (id) => {
            try {
              return [id, (await api.forms(id)).length > 0] as const;
            } catch {
              return [id, backgroundWaitingRef.current.has(id)] as const;
            }
          }),
        );
        if (cancelled) return;
        setBackgroundWaitingIds((previous) => {
          const next = new Set(previous);
          for (const [id, waiting] of results) {
            if (id === selectedIdRef.current) continue;
            if (waiting) next.add(id);
            else next.delete(id);
          }
          const known = new Set(sessionsRef.current.map((session) => session.id));
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
    const key = `${scope}|${workspace}`;
    if (lastQueryRef.current === key) return;
    lastQueryRef.current = key;
    if (healthRef.current?.ok) void loadSessions();
  }, [loadSessions, scope, workspace]);

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
    if (streamFrame.current !== null) {
      cancelAnimationFrame(streamFrame.current);
      streamFrame.current = null;
    }
    streamQueue.current = [];
    if (!selectedId) {
      setMessages([]);
      setTranscriptError(null);
      return;
    }
    if (skipLoadRef.current === selectedId) {
      skipLoadRef.current = null;
      return;
    }
    let cancelled = false;
    setMessagesLoading(true);
    setTranscriptError(null);
    api.messages(selectedId)
      .then((data) => {
        if (cancelled) return;
        setMessages(normalizeMessages(data));
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
    if (!selectedId || sessionsLoading) return;
    if (!sessions.some((session) => session.id === selectedId)) {
      setSelectedIdState(null);
      localStorage.removeItem("nit-gui.session");
    }
  }, [sessions, sessionsLoading, selectedId]);

  useEffect(() => {
    if (!selectedId || showHidden || !hiddenIds.has(selectedId)) return;
    setSelectedIdState(null);
    localStorage.removeItem("nit-gui.session");
  }, [hiddenIds, selectedId, showHidden]);

  const selectSession = useCallback((id: string | null) => {
    if (id !== selectedIdRef.current) {
      setMessages([]);
      setTranscriptError(null);
    }
    setSelectedIdState(id);
    if (id) localStorage.setItem("nit-gui.session", id);
    else localStorage.removeItem("nit-gui.session");
    setSidebarOpen(false);
  }, []);

  const selectWorkspace = useCallback((directory: string) => {
    const value = directory.trim().replace(/\/+$/, "") || "/";
    setWorkspaceState(value);
    localStorage.setItem("nit-gui.workspace", value);
    setRecent((previous) => {
      const next = [value, ...previous.filter((item) => item !== value)].slice(0, 8);
      localStorage.setItem("nit-gui.recent", JSON.stringify(next));
      return next;
    });
    setScopeState("directory");
    localStorage.setItem("nit-gui.scope", "directory");
    setSelectedIdState(null);
    localStorage.removeItem("nit-gui.session");
    setMessages([]);
    setPickerOpen(false);
  }, []);

  const changeScope = useCallback((next: Scope) => {
    setScopeState(next);
    localStorage.setItem("nit-gui.scope", next);
  }, []);

  const newChat = useCallback(() => {
    selectSession(null);
    setSidebarOpen(false);
    if (!workspaceRef.current) setPickerOpen(true);
  }, [selectSession]);

  const toggleSidebar = useCallback(() => {
    setCollapsed((current) => {
      const next = !current;
      localStorage.setItem("nit-gui.collapsed", next ? "1" : "0");
      return next;
    });
  }, []);

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
        saveHidden(next);
        return next;
      });
      if (selectedIdRef.current && ids.includes(selectedIdRef.current)) selectSession(null);
    },
    [selectSession, sessionAndChildren],
  );

  const unhideSession = useCallback(
    (id: string) => {
      const ids = sessionAndChildren(id);
      setHiddenIds((current) => {
        const next = new Set(current);
        for (const item of ids) next.delete(item);
        saveHidden(next);
        return next;
      });
    },
    [sessionAndChildren],
  );

  const deleteSession = useCallback(
    async (id: string) => {
      if (!window.confirm("Delete this chat? This cannot be undone.")) return;
      setBanner(null);
      try {
        await api.deleteSession(id);
        setSessions((current) => current.filter((item) => item.id !== id));
        setHiddenIds((current) => {
          if (!current.has(id)) return current;
          const next = new Set(current);
          next.delete(id);
          saveHidden(next);
          return next;
        });
        if (selectedIdRef.current === id) selectSession(null);
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
    setMessageEpoch((value) => value + 1);
  }, []);

  const onEvent = (event: StreamEvent) => {
    const data = event.data ?? {};
    const sessionID = typeof data.sessionID === "string" ? data.sessionID : "";

    if (sessionID) {
      if (event.type === "session.execution.started") {
        runningEventsAt.current[sessionID] = Date.now();
        setRunningIds((previous) => ({ ...previous, [sessionID]: true }));
      }
      if (
        event.type === "session.idle" ||
        event.type === "session.execution.succeeded" ||
        event.type === "session.execution.failed" ||
        event.type === "session.execution.interrupted"
      ) {
        runningEventsAt.current[sessionID] = Date.now();
        setRunningIds((previous) => ({ ...previous, [sessionID]: false }));
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
    void loadSessions();
    void loadChildren();
    void loadForms();
    reloadSelected();
  };

  const streamStatus = useEventStream(onEvent, onStreamOpen);

  const send = useCallback(
    async (text: string, attachments: Attachment[] = [], delivery?: "queue" | "steer") => {
      setBanner(null);
      const files = attachments
        .filter((item) => item.path)
        .map((item) => ({ uri: `file://${item.path}`, name: item.name }));
      let id = selectedIdRef.current;
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
          skipLoadRef.current = session.id;
          setSessions((previous) => [
            session,
            ...previous.filter((item) => item.id !== session.id),
          ]);
          setRunningIds((previous) => ({ ...previous, [session.id]: false }));
          setSelectedIdState(session.id);
          localStorage.setItem("nit-gui.session", session.id);
          setMessages([]);
          setSidebarOpen(false);
        } catch (error) {
          setBanner(messageOf(error));
          throw error;
        }
      }
      if (!id) throw new Error("Session was not created.");
      const sessionId = id;
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
        await api.prompt(sessionId, text, files, delivery);
      } catch (error) {
        setRunningIds((previous) => ({ ...previous, [sessionId]: false }));
        setBanner(messageOf(error));
        throw error;
      }
    },
    [currentAgent, currentModel],
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
      localStorage.setItem("nit-gui.model", JSON.stringify(model));
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
      localStorage.setItem("nit-gui.agent", agent);
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
      if (!session || !target || runningNow) return;
      setBanner(null);
      try {
        await api.revert(session.id, target.id);
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
      if (!session || runningNow) return;
      setBanner(null);
      try {
        const forked = await api.fork(session.id, target?.id);
        setSessions((previous) => [forked, ...previous.filter((item) => item.id !== forked.id)]);
        selectSession(forked.id);
      } catch (error) {
        setBanner(messageOf(error));
      }
    },
    [previousUser, runningNow, selectSession, selectedSession],
  );

  const compactSession = useCallback(async () => {
    const id = selectedIdRef.current;
    if (!id) return;
    setBanner(null);
    try {
      await api.compact(id);
      reloadSelected();
      void loadSessions();
    } catch (error) {
      setBanner(messageOf(error));
    }
  }, [loadSessions, reloadSelected]);

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
          cycle();
          break;
        case "help":
          setBanner(
            "Commands: /new /dir /compact /revert /fork /retry /theme /clear /help · Shortcuts: Alt+N new chat, Alt+J/K next/prev chat, Ctrl/⌘K search",
          );
          break;
      }
    },
    [compactSession, cycle, forkAt, lastUser, newChat, retryLast, revertLast],
  );

  const cycleSessions = useMemo(
    () =>
      groupSessions(
        filterSessions(
          showHidden ? sessions : sessions.filter((session) => !hiddenIds.has(session.id)),
          search,
        ),
        waitingIds,
      ).map((row) => row.session),
    [hiddenIds, search, sessions, showHidden, waitingIds],
  );

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
      if (event.key === "Escape") {
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
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cycleSessions, isRunning, newChat, selectSession, stop]);

  if (booting) return <BootScreen />;

  if (health && !health.ok && sessions.length === 0) {
    return <OfflineScreen health={health} onRetry={() => void retryConnection()} />;
  }

  if (!workspace) {
    return (
      <WorkspacePicker
        projects={projects}
        recent={recent}
        motion={motion}
        variant={background}
        onPick={selectWorkspace}
      />
    );
  }

  const offlineBanner = health && !health.ok ? "OpenCode service is offline." : null;
  const activeError = banner ?? offlineBanner;
  const running = selectedId ? isRunning(selectedId) : false;
  const hiddenCount = sessions.filter((session) => hiddenIds.has(session.id)).length;
  const visibleSessions = showHidden
    ? sessions
    : sessions.filter((session) => !hiddenIds.has(session.id));
  const hoverSidebar = sidebarMode === "hover";
  const questionForm = forms[0] && questionField(forms[0]) ? forms[0] : null;
  const finishForm = () => {
    setForms((current) => current.slice(1));
    reloadSelected();
  };

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
        onPointerEnter={hoverSidebar ? openHoverSidebar : undefined}
        onPointerLeave={hoverSidebar ? closeHoverSidebar : undefined}
        className={cn(
          "border-border bg-background fixed inset-y-0 left-0 z-30 w-[280px] border-r",
          "ease-[cubic-bezier(0.32,0.72,0,1)] transition-[translate,opacity,width] duration-300 motion-reduce:transition-none",
          sidebarOpen ? "translate-x-0 shadow-xl" : "-translate-x-full",
          hoverSidebar
            ? sidebarHovered
              ? "md:z-40 md:translate-x-0 md:opacity-100 md:shadow-2xl"
              : "md:z-40 md:-translate-x-full md:opacity-0 md:shadow-2xl"
            : cn(
                "md:static md:z-auto md:translate-x-0",
                collapsed ? "md:w-0 md:overflow-hidden md:border-r-0" : "md:w-[280px] lg:w-[300px]",
              ),
        )}
      >
        <div
          className={cn(
            "h-full",
            hoverSidebar &&
              "transition-[translate] duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none",
            hoverSidebar && !sidebarHovered && "md:-translate-x-4",
          )}
        >
          <Sidebar
            sessions={visibleSessions}
            workspace={workspace}
            scope={scope}
            selectedId={selectedId}
            loading={sessionsLoading}
            health={health}
            search={search}
            searchRef={searchRef}
            hiddenIds={hiddenIds}
            hiddenCount={hiddenCount}
            showHidden={showHidden}
            onSearch={setSearch}
            onScope={changeScope}
            onWorkspace={() => setPickerOpen(true)}
            onSelect={selectSession}
            onNew={newChat}
            onHide={hideSession}
            onUnhide={unhideSession}
            onDelete={deleteSession}
            onToggleHidden={() => setShowHidden((value) => !value)}
            isRunning={isRunning}
            waitingIds={waitingIds}
            motion={motion}
          />
        </div>
      </aside>

      {sidebarOpen && (
        <button
          type="button"
          aria-label="Close sessions"
          className="fixed inset-0 z-20 bg-black/40 md:hidden"
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
          health={health}
          streamStatus={streamStatus}
          theme={theme}
          collapsed={collapsed}
          sidebarMode={sidebarMode}
          subagents={subagents}
          parent={parentSession}
          onOpenSubagent={openSubagent}
          onBack={backToParent}
          onSettings={() => setSettingsOpen(true)}
          onToggleSidebar={toggleSidebar}
          onTheme={cycle}
          onMenu={() => setSidebarOpen(true)}
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
          error={transcriptError}
          models={models}
          agents={agents}
          projects={projects}
          recent={recent}
          workspace={workspace}
          motion={motion}
          background={background}
          onRetry={reloadSelected}
          onRevert={(message) => void revertAt(message)}
          onFork={(message) => void forkAt(message)}
          onQuote={quoteSelection}
          onPickWorkspace={selectWorkspace}
          onBrowseWorkspace={() => setPickerOpen(true)}
        />

        <BottomDock>
          {forms[0] && selectedSession && !questionForm && (
            <div className="pointer-events-auto">
              <FormCard
                form={forms[0]}
                sessionID={selectedSession.id}
                onDone={finishForm}
                onError={(message) => setBanner(message)}
              />
            </div>
          )}

          <div className="pointer-events-auto">
            <Composer
              key={composerKey}
              session={selectedSession}
              workspace={workspace}
              model={modelInfo}
              draftKey={composerKey}
              disabled={!health?.ok}
              running={running}
              focusKey={selectedId}
              typingBlocked={settingsOpen || pickerOpen}
              drawerOpen={sidebarOpen}
              draft={composerDraft}
              insert={composerInsert}
              commands={COMMANDS}
              dictationMode={dictationMode}
              spellcheck={spellcheck}
              autofix={autofix}
              form={questionForm}
              onSend={send}
              onStop={() => void stop()}
              onCommand={runCommand}
              onError={(message) => setBanner(message)}
              onFormDone={finishForm}
              onDraftApplied={() => setComposerDraft(null)}
              onInsertApplied={() => setComposerInsert(null)}
            />
          </div>
        </BottomDock>
      </main>

      {pickerOpen && (
        <WorkspacePicker
          projects={projects}
          recent={recent}
          current={workspace}
          motion={motion}
          variant={background}
          onPick={selectWorkspace}
          onClose={() => setPickerOpen(false)}
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
          dictationMode={dictationMode}
          spellcheck={spellcheck}
          autofix={autofix}
          motion={motion}
          background={background}
          sidebarMode={sidebarMode}
          onModel={(model) => void changeModel(model)}
          onAgent={(agent) => void changeAgent(agent)}
          onTheme={setTheme}
          onSidebar={(mode) => {
            setSidebarMode(mode);
            localStorage.setItem("nit-gui.sidebar-mode", mode);
            setSidebarHovered(false);
          }}
          onDictation={(mode) => {
            setDictationMode(mode);
            localStorage.setItem("nit-gui.dictation", mode);
          }}
          onSpellcheck={(value) => {
            setSpellcheck(value);
            localStorage.setItem("nit-gui.spellcheck", value ? "1" : "0");
          }}
          onAutofix={(value) => {
            setAutofix(value);
            localStorage.setItem("nit-gui.autofix", value ? "1" : "0");
          }}
          onMotion={(value) => {
            setMotion(value);
            localStorage.setItem("nit-gui.motion", value);
          }}
          onBackground={(value) => {
            setBackground(value);
            localStorage.setItem("nit-gui.background", value);
          }}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}
