import { useEffect, useState } from "react";
import { ArrowRight, RefreshCw, Server, X } from "lucide-react";
import type { CapabilityState, InstanceCapability, InstancesResponse } from "../lib/types";
import { mergeDeviceCapabilities } from "../lib/instances";
import { cn } from "../lib/utils";
import { useModalFocus } from "../hooks/useModalFocus";
import { Button } from "./ui/button";

const dotClass: Record<string, string> = {
  connected: "bg-success",
  offline: "bg-destructive",
  unknown: "bg-muted-foreground",
};

const tagClass: Record<string, string> = {
  required: "border-primary/30 bg-primary/10 text-primary",
  on: "border-success/30 bg-success/10 text-success",
  fallback: "border-border bg-muted text-muted-foreground",
  off: "border-destructive/30 bg-destructive/10 text-destructive",
  unknown: "border-border bg-muted text-muted-foreground",
};

function capabilityTag(cap: InstanceCapability, state: CapabilityState): string {
  return cap.required ? "required" : state;
}

function FlowNode({ label }: { label: string }) {
  return (
    <span className="border-border bg-muted/30 max-w-full truncate rounded-md border px-2 py-1 font-mono text-[10px]">
      {label}
    </span>
  );
}

export function InstancesMenu({
  data,
  active,
  configError,
  onSelect,
  onRefresh,
  onClose,
}: {
  data: InstancesResponse;
  active: string;
  configError?: string;
  onSelect: (id: string) => void;
  onRefresh: () => void;
  onClose: () => void;
}) {
  const panel = useModalFocus<HTMLDivElement>();
  const [selected, setSelected] = useState(active);
  const supportsSpeech = typeof window !== "undefined" && "speechSynthesis" in window;

  useEffect(() => {
    setSelected(active);
  }, [active]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const info =
    data.instances.find((item) => item.id === selected) ??
    data.instances.find((item) => item.id === active) ??
    data.instances[0];
  const caps = info
    ? mergeDeviceCapabilities(info.capabilities ?? [], supportsSpeech)
    : [];

  return (
    <div
      className="overlay-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Instances"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className="overlay-modal bg-background border-border flex max-h-[calc(100dvh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-xl border shadow-xl outline-none"
      >
        <div className="border-border flex items-center justify-between border-b px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Server className="size-4" />
            Instances
          </h2>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close instances">
            <X />
          </Button>
        </div>

        <div className="border-border space-y-1 border-b px-4 py-3">
          <div className="font-mono text-[11px]">
            This app: {data.app.name} @ {data.app.host}
          </div>
          <div className="text-muted-foreground text-[11px] leading-5">
            OpenCode + nit-gui are required. Everything else only adds capabilities.
          </div>
          {configError && (
            <div className="border-destructive/30 bg-destructive/10 text-destructive mt-2 rounded-md border px-2.5 py-1.5 text-[11px]">
              {configError}
            </div>
          )}
        </div>

        <div className="grid min-h-0 flex-1 overflow-y-auto min-[760px]:grid-cols-[minmax(0,17rem)_minmax(0,1fr)] min-[760px]:overflow-hidden">
          <div className="border-border border-b p-2 min-[760px]:overflow-y-auto min-[760px]:border-r min-[760px]:border-b-0">
            <div className="text-muted-foreground px-2.5 py-1 text-[10px] uppercase tracking-wide">
              OpenCode instances
            </div>
            {data.instances.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelected(item.id)}
                className={cn(
                  "flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left",
                  selected === item.id ? "bg-accent" : "hover:bg-accent/60",
                )}
              >
                <span
                  className={cn(
                    "mt-1.5 size-2 shrink-0 rounded-full",
                    dotClass[item.state] ?? dotClass.unknown,
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-xs font-medium">{item.name}</span>
                    <span className="border-border text-muted-foreground shrink-0 rounded border px-1 font-mono text-[9px] uppercase">
                      {item.transport}
                    </span>
                    {item.id === active && (
                      <span className="text-muted-foreground shrink-0 text-[9px]">active</span>
                    )}
                  </span>
                  <span className="text-muted-foreground block truncate text-[11px]">
                    {item.state}
                    {item.detail ? ` · ${item.detail}` : ""}
                  </span>
                  {item.error && (
                    <span className="text-destructive block truncate text-[10px]">
                      {item.error}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>

          <div className="min-[760px]:overflow-y-auto">
            {info ? (
              <div className="space-y-4 p-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold">{info.name}</h3>
                    <span className="border-border text-muted-foreground rounded-full border px-2 py-0.5 text-[10px]">
                      {info.state}
                    </span>
                  </div>
                  <div className="text-muted-foreground mt-1 text-[11px]">
                    {info.detail || info.transport}
                  </div>
                  {info.error && (
                    <div className="text-destructive mt-1 text-[11px]">{info.error}</div>
                  )}
                </div>

                <div className="space-y-1.5">
                  <div className="text-muted-foreground text-[10px] uppercase tracking-wide">
                    Where it runs
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <FlowNode label="Browser" />
                    <ArrowRight className="text-muted-foreground size-3 shrink-0" />
                    <FlowNode label={`${data.app.name} @ ${data.app.host}`} />
                    <ArrowRight className="text-muted-foreground size-3 shrink-0" />
                    <FlowNode label={`OpenCode @ ${info.name}`} />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="text-muted-foreground text-[10px] uppercase tracking-wide">
                    Capabilities
                  </div>
                  {caps.map((cap) => {
                    const tag = capabilityTag(cap, cap.state);
                    return (
                      <div
                        key={cap.id}
                        className="border-border flex items-start gap-2 rounded-lg border px-2.5 py-2"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline gap-1.5">
                            <span className="text-xs font-medium">{cap.label}</span>
                            <span className="text-muted-foreground text-[10px]">{cap.owner}</span>
                          </div>
                          {cap.detail && (
                            <div className="text-muted-foreground mt-0.5 text-[11px]">
                              {cap.detail}
                            </div>
                          )}
                        </div>
                        <span
                          className={cn(
                            "shrink-0 rounded border px-1.5 py-0.5 text-[9px] uppercase",
                            tagClass[tag] ?? tagClass.unknown,
                          )}
                        >
                          {tag}
                        </span>
                      </div>
                    );
                  })}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {info.id !== active && (
                    <Button size="sm" onClick={() => onSelect(info.id)}>
                      Switch
                    </Button>
                  )}
                  {(info.state === "offline" || info.state === "unknown") && (
                    <Button variant="outline" size="sm" onClick={onRefresh}>
                      <RefreshCw />
                      Reconnect
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={onClose}>
                    Close
                  </Button>
                </div>
              </div>
            ) : (
              <div className="text-muted-foreground p-4 text-sm">No instances configured.</div>
            )}
          </div>
        </div>

        <div className="border-border text-muted-foreground border-t px-4 py-3 font-mono text-[10px]">
          Edit ~/.config/nit-gui/instances.json on {data.app.host} to add or change instances.
        </div>
      </div>
    </div>
  );
}
