import { useCallback, useEffect, useState } from "react";
import { CircleAlert, RefreshCw } from "lucide-react";
import App from "./App";
import { api } from "./lib/api";
import type { InstancesResponse } from "./lib/types";
import { BootScreen } from "./components/StatusScreens";
import { InstancesMenu } from "./components/InstancesMenu";
import { Button } from "./components/ui/button";

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Could not load instances";
}

function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="bg-background flex h-full items-center justify-center px-6">
      <div className="max-w-md text-center">
        <div className="bg-destructive/10 text-destructive mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl">
          <CircleAlert className="size-6" />
        </div>
        <h1 className="text-xl font-semibold tracking-tight">Could not load instances</h1>
        <pre className="bg-muted text-muted-foreground mt-4 overflow-x-auto rounded-lg px-3 py-2 text-left font-mono text-[11px] whitespace-pre-wrap">
          {message}
        </pre>
        <Button className="mt-5" onClick={onRetry}>
          <RefreshCw />
          Retry
        </Button>
      </div>
    </div>
  );
}

export default function Root() {
  const [data, setData] = useState<InstancesResponse | null>(null);
  const [active, setActive] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const result = await api.instances();
      setData(result);
      const stored = localStorage.getItem("nit-gui.instance");
      setActive(
        stored && result.instances.some((item) => item.id === stored) ? stored : result.default,
      );
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
      const result = await api.instances(true);
      setData(result);
      setActive((current) =>
        result.instances.some((item) => item.id === current) ? current : result.default,
      );
    } catch (cause) {
      setError(messageOf(cause));
    }
  }, []);

  const select = useCallback((id: string) => {
    setActive(id);
    localStorage.setItem("nit-gui.instance", id);
    setMenuOpen(false);
  }, []);

  if (!data) {
    if (error) return <LoadError message={error} onRetry={() => void load()} />;
    return <BootScreen />;
  }

  const info =
    data.instances.find((item) => item.id === active) ??
    data.instances.find((item) => item.id === data.default) ??
    data.instances[0];

  if (!info) {
    return (
      <LoadError
        message="No OpenCode instances are configured."
        onRetry={() => void load()}
      />
    );
  }

  api.setInstance(info.id);

  return (
    <>
      <App
        key={info.id}
        instance={info.id}
        defaultInstance={data.default}
        defaultDirectory={info.defaultDirectory}
        onOpenInstances={() => setMenuOpen(true)}
      />
      {menuOpen && (
        <InstancesMenu
          data={data}
          active={info.id}
          configError={data.configError || error || ""}
          onSelect={select}
          onRefresh={() => void refresh()}
          onClose={() => setMenuOpen(false)}
        />
      )}
    </>
  );
}
