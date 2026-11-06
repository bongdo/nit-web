import { ArrowLeftRight, Loader2, PlugZap, RefreshCw } from "lucide-react";
import type { Health } from "../lib/types";
import { Button } from "./ui/button";

export function BootScreen({
  instance,
  onSwitch,
}: {
  instance?: string;
  onSwitch?: () => void;
}) {
  return (
    <div className="bg-background flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" />
          Connecting to OpenCode…
        </div>
        {instance && (
          <div className="text-muted-foreground font-mono text-[11px]">{instance}</div>
        )}
        {onSwitch && (
          <Button variant="outline" size="sm" onClick={onSwitch}>
            <ArrowLeftRight />
            Switch instance
          </Button>
        )}
      </div>
    </div>
  );
}

export function OfflineScreen({
  health,
  onRetry,
  instance,
  onSwitch,
}: {
  health: Health;
  onRetry: () => void;
  instance?: string;
  onSwitch?: () => void;
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
        {instance && (
          <div className="text-muted-foreground mt-2 font-mono text-[11px]">instance {instance}</div>
        )}
        {health.error && (
          <pre className="bg-muted text-muted-foreground mt-4 overflow-x-auto rounded-lg px-3 py-2 text-left font-mono text-[11px] whitespace-pre-wrap">
            {health.error}
          </pre>
        )}
        <div className="text-muted-foreground mt-4 font-mono text-[11px]">
          opencode service status
        </div>
        <div className="mt-5 flex items-center justify-center gap-2">
          <Button onClick={onRetry}>
            <RefreshCw />
            Retry
          </Button>
          {onSwitch && (
            <Button variant="outline" onClick={onSwitch}>
              <ArrowLeftRight />
              Switch instance
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
