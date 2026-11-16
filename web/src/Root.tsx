import { useCallback, useEffect, useState } from "react";
import App from "./App";
import { api } from "./lib/api";
import { prefetchBoot } from "./lib/bootCache";
import { appLabel } from "./lib/instances";
import type { InstancesResponse } from "./lib/types";
import { InstancesMenu } from "./components/InstancesMenu";

const CACHE_KEY = "nit-gui.instances.v1";

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Could not load instances";
}

function readCached(): InstancesResponse | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as InstancesResponse;
    if (!value || !Array.isArray(value.instances) || value.instances.length === 0) return null;
    if (typeof value.default !== "string" || !value.app) return null;
    return value;
  } catch {
    return null;
  }
}

function writeCached(value: InstancesResponse) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(value));
  } catch {}
}

export default function Root() {
  const [data, setData] = useState<InstancesResponse | null>(() => readCached());
  const [active, setActive] = useState(() => localStorage.getItem("nit-gui.instance") || "");
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const result = await api.instances("none");
      setData(result);
      writeCached(result);
      const stored = localStorage.getItem("nit-gui.instance");
      const next =
        stored && result.instances.some((item) => item.id === stored) ? stored : result.default;
      setActive(next);
      localStorage.setItem("nit-gui.instance", next);
    } catch (cause) {
      setError(messageOf(cause));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const result = await api.instances("all");
      setData(result);
      writeCached(result);
      setActive((current) =>
        result.instances.some((item) => item.id === current) ? current : result.default,
      );
    } catch (cause) {
      setError(messageOf(cause));
    }
  }, []);

  const seed = active || localStorage.getItem("nit-gui.instance") || "local";
  const seedWorkspace =
    localStorage.getItem("nit-gui.workspace") ||
    localStorage.getItem(`nit-gui.workspace:${seed}`) ||
    undefined;
  const current: InstancesResponse = data ?? {
    app: { name: "nit-gui", host: "", version: "dev" },
    default: seed,
    instances: [
      {
        id: seed,
        name: seed,
        transport: "local",
        detail: "",
        state: "unknown",
        defaultDirectory: seedWorkspace,
        capabilities: [],
      },
    ],
  };

  const select = useCallback(
    (id: string) => {
      setMenuOpen(false);
      const target = current.instances.find((item) => item.id === id);
      if (id !== active && target && target.state !== "offline") {
        void prefetchBoot(id);
      }
      setActive(id);
      localStorage.setItem("nit-gui.instance", id);
    },
    [active, current.instances],
  );

  const openMenu = useCallback(() => {
    setMenuOpen(true);
    void refresh();
  }, [refresh]);

  const info =
    current.instances.find((item) => item.id === active) ??
    current.instances.find((item) => item.id === current.default) ??
    current.instances[0];

  api.setInstance(info.id);

  return (
    <>
      <App
        key={`${info.id}:${current.default}:${data ? "ready" : "seed"}`}
        instance={info.id}
        defaultInstance={current.default}
        defaultDirectory={info.defaultDirectory}
        instances={current.instances}
        title={`${appLabel(current.app.host)} · ${info.id}`}
        onOpenInstances={openMenu}
        onSwitchInstance={select}
      />
      {error && (
        <div className="border-destructive/30 bg-destructive/10 text-destructive fixed bottom-3 left-1/2 z-40 max-w-[calc(100vw-1.5rem)] -translate-x-1/2 rounded-md border px-3 py-1.5 text-xs shadow-sm backdrop-blur-xl">
          {data ? "Instances are stale: " : "Instances unavailable: "}
          {error}
        </div>
      )}
      {menuOpen && (
        <InstancesMenu
          data={current}
          active={info.id}
          configError={current.configError || error || ""}
          onSelect={select}
          onRefresh={refresh}
          onClose={() => setMenuOpen(false)}
        />
      )}
    </>
  );
}
