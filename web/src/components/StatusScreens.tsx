import { Loader2, PlugZap, RefreshCw } from "lucide-react";
import type { Health } from "../lib/types";
import { Button } from "./ui/button";

export function BootScreen() {
  return (
    <div className="bg-background flex h-full items-center justify-center">
      <div className="text-muted-foreground flex items-center gap-2 text-sm">
        <Loader2 className="size-4 animate-spin" />
        Connecting to OpenCode…
      </div>
    </div>
  );
}

export function OfflineScreen({
  health,
  onRetry,
}: {
  health: Health;
  onRetry: () => void;
}) {
  return (
    <div className="bg-background flex h-full items-center justify-center px-6">
      <div className="max-w-md text-center">
        <div className="bg-destructive/10 text-destructive mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl">
          <PlugZap className="size-6" />
        </div>
        <h1 className="text-xl font-semibold tracking-tight">OpenCode service is offline</h1>
        <p className="text-muted-foreground mt-2 text-sm leading-6">
          nit-gui talks to the local OpenCode service. Start it, then retry. Your sessions are
          stored by OpenCode, not here.
        </p>
        {health.error && (
          <pre className="bg-muted text-muted-foreground mt-4 overflow-x-auto rounded-lg px-3 py-2 text-left font-mono text-[11px] whitespace-pre-wrap">
            {health.error}
          </pre>
        )}
        <div className="text-muted-foreground mt-4 font-mono text-[11px]">
          opencode service status
        </div>
        <Button className="mt-5" onClick={onRetry}>
          <RefreshCw />
          Retry
        </Button>
      </div>
    </div>
  );
}
