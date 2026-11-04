import { useCallback, useEffect, useRef, useState } from "react";
import { CircleAlert, RefreshCw, X } from "lucide-react";
import { api } from "./lib/api";
import type {
  Agent,
  Config,
  Health,
  Message,
  Model,
  ModelRef,
  Session,
  StreamEvent,
} from "./lib/types";
import { applyEvent, normalizeMessages } from "./lib/stream";
import { mergeRunningStates, modelLabel, sessionRunning } from "./lib/format";
import { cn } from "./lib/utils";
import { useTheme } from "./hooks/useTheme";
import { useEventStream } from "./hooks/useEventStream";
import { ChatView } from "./components/ChatView";
import { Composer } from "./components/Composer";
import { Header } from "./components/Header";
import { Sidebar } from "./components/Sidebar";
import { BootScreen, OfflineScreen } from "./components/StatusScreens";
import { Button } from "./components/ui/button";

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong";
}

export default function App() {
  const { theme, cycle } = useTheme();
  const [health, setHealth] = useState<Health | null>(null);
  const healthRef = useRef<Health | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [models, setModels] = useState<Model[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [selectedId, setSelectedIdState] = useState<string | null>(() =>
    localStorage.getItem("nit-gui.session"),
  );
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const [messages, setMessages] = useState<Message[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messageEpoch, setMessageEpoch] = useState(0);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const [runningIds, setRunningIds] = useState<Record<string, boolean>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [preferredModel, setPreferredModel] = useState<ModelRef | null>(null);
  const [preferredAgent, setPreferredAgent] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const refreshTimer = useRef<number | null>(null);
  const firstStreamOpen = useRef(true);
  const runningEventsAt = useRef<Record<string, number>>({});

  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const selectedSession = sessions.find((session) => session.id === selectedId) ?? null;
  const currentModel = selectedSession?.model ?? preferredModel ?? config?.model ?? null;
  const currentAgent = selectedSession?.agent ?? preferredAgent ?? config?.agent ?? null;

  const isRunning = useCallback(
    (id: string) =>
      runningIds[id] ??
      sessionRunning(sessions.find((session) => session.id === id)),
    [runningIds, sessions],
  );

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
    try {
      const list = await api.sessions();
      setSessions(list.data);
      setRunningIds((previous) =>
        mergeRunningStates(previous, list.data, runningEventsAt.current, requestedAt),
      );
    } catch (error) {
      setBanner(messageOf(error));
    } finally {
      setSessionsLoading(false);
    }
  }, []);

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
      await Promise.all([loadCatalog(), loadSessions()]);
    }
    setBooting(false);
  }, [loadCatalog, loadHealth, loadSessions]);

  useEffect(() => {
    void (async () => {
      const result = await loadHealth();
      if (result.ok) {
        await Promise.all([loadCatalog(), loadSessions()]);
      } else {
        setSessionsLoading(false);
      }
      setBooting(false);
    })();
  }, [loadCatalog, loadHealth, loadSessions]);

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
    if (!selectedId) {
      setMessages([]);
      setTranscriptError(null);
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

  const scheduleSessionsRefresh = useCallback(() => {
    if (refreshTimer.current !== null) return;
    refreshTimer.current = window.setTimeout(() => {
      refreshTimer.current = null;
      void loadSessions();
    }, 500);
  }, [loadSessions]);

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

    if (sessionID === selectedIdRef.current) {
      if (
        event.type.startsWith("session.text.") ||
        event.type.startsWith("session.reasoning.") ||
        event.type.startsWith("session.tool.") ||
        event.type === "session.step.started" ||
        event.type === "session.step.ended" ||
        event.type === "session.step.failed"
      ) {
        setMessages((previous) => applyEvent(previous, event));
      }
      if (
        event.type === "session.idle" ||
        event.type === "session.execution.succeeded" ||
        event.type === "session.execution.failed" ||
        event.type === "session.execution.interrupted"
      ) {
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
    reloadSelected();
  };

  const streamStatus = useEventStream(onEvent, onStreamOpen);

  const createSession = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    setBanner(null);
    try {
      const session = await api.createSession({
        directory: config?.directory,
        agent: currentAgent ?? undefined,
        model: currentModel,
      });
      setSessions((previous) => [session, ...previous.filter((item) => item.id !== session.id)]);
      setRunningIds((previous) => ({ ...previous, [session.id]: false }));
      setMessages([]);
      selectSession(session.id);
    } catch (error) {
      setBanner(messageOf(error));
    } finally {
      setCreating(false);
    }
  }, [config?.directory, creating, currentAgent, currentModel, selectSession]);

  const send = useCallback(
    async (text: string) => {
      const id = selectedIdRef.current;
      if (!id) return;
      setBanner(null);
      const optimistic: Message = {
        id: `local-${Date.now()}`,
        type: "user",
        time: { created: Date.now() },
        text,
      };
      setMessages((previous) => [...previous, optimistic]);
      runningEventsAt.current[id] = Date.now();
      setRunningIds((previous) => ({ ...previous, [id]: true }));
      try {
        await api.prompt(id, text);
      } catch (error) {
        setRunningIds((previous) => ({ ...previous, [id]: false }));
        setBanner(messageOf(error));
        throw error;
      }
    },
    [],
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
      if (mod && key === "n") {
        event.preventDefault();
        void createSession();
        return;
      }
      if (event.key === "Escape") {
        if (selectedIdRef.current && isRunning(selectedIdRef.current)) {
          void stop();
        }
        setSidebarOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [createSession, isRunning, stop]);

  if (booting) return <BootScreen />;

  if (health && !health.ok && sessions.length === 0) {
    return <OfflineScreen health={health} onRetry={() => void retryConnection()} />;
  }

  const offlineBanner = health && !health.ok ? "OpenCode service is offline." : null;
  const activeError = banner ?? offlineBanner;
  const running = selectedId ? isRunning(selectedId) : false;

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      <aside
        className={cn(
          "border-border bg-background fixed inset-y-0 left-0 z-30 w-[280px] border-r transition-transform duration-200 md:static md:z-auto md:w-[280px] md:translate-x-0 lg:w-[300px]",
          sidebarOpen ? "translate-x-0 shadow-xl" : "-translate-x-full",
        )}
      >
        <Sidebar
          sessions={sessions}
          selectedId={selectedId}
          loading={sessionsLoading}
          creating={creating}
          health={health}
          search={search}
          searchRef={searchRef}
          onSearch={setSearch}
          onSelect={selectSession}
          onNew={() => void createSession()}
          isRunning={isRunning}
        />
      </aside>

      {sidebarOpen && (
        <button
          type="button"
          aria-label="Close sessions"
          className="fixed inset-0 z-20 bg-black/40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <main className="flex min-w-0 flex-1 flex-col">
        <Header
          session={selectedSession}
          directory={config?.directory}
          models={models}
          agents={agents}
          model={currentModel}
          agent={currentAgent}
          health={health}
          streamStatus={streamStatus}
          theme={theme}
          onModel={(model) => void changeModel(model)}
          onAgent={(agent) => void changeAgent(agent)}
          onTheme={cycle}
          onMenu={() => setSidebarOpen(true)}
        />

        {activeError && (
          <div className="border-destructive/30 bg-destructive/10 text-destructive flex shrink-0 items-center gap-2 border-b px-4 py-2 text-xs">
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
          directory={config?.directory}
          onRetry={reloadSelected}
          onNew={() => void createSession()}
        />

        <Composer
          session={selectedSession}
          disabled={!health?.ok || creating}
          running={running}
          modelName={modelLabel(currentModel, models)}
          focusKey={selectedId}
          onSend={send}
          onStop={() => void stop()}
        />
      </main>
    </div>
  );
}
