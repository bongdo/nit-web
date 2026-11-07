import { useEffect, useState, type ReactNode } from "react";
import { ArrowRight, Plus, RefreshCw, Server, X } from "lucide-react";
import { api } from "../lib/api";
import type {
  CapabilityState,
  Instance,
  InstanceCapability,
  InstanceInput,
  InstanceTransport,
  InstancesResponse,
} from "../lib/types";
import { mergeDeviceCapabilities } from "../lib/instances";
import { cn } from "../lib/utils";
import { useModalFocus } from "../hooks/useModalFocus";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Select } from "./ui/select";

const dotClass: Record<string, string> = {
  connected: "bg-success",
  offline: "bg-destructive",
  unknown: "bg-muted-foreground",
};

const tagClass: Record<string, string> = {
  required: "border-primary/30 bg-primary/10 text-primary",
  on: "border-success/30 bg-success/10 text-success",
  fallback: "border-attention/30 bg-attention/10 text-attention",
  off: "border-border bg-muted text-muted-foreground",
  unknown: "border-border border-dashed bg-transparent text-muted-foreground",
};

type FormState = {
  original?: string;
  name: string;
  transport: InstanceTransport;
  url: string;
  ssh: string;
  dir: string;
  password: string;
  passwordFile: string;
};

function newForm(): FormState {
  return {
    name: "",
    transport: "local",
    url: "",
    ssh: "",
    dir: "",
    password: "",
    passwordFile: "",
  };
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-muted-foreground block text-[10px] uppercase tracking-wide">
        {label}
      </span>
      {children}
    </label>
  );
}

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
  onRefresh: () => void | Promise<void>;
  onClose: () => void;
}) {
  const panel = useModalFocus<HTMLDivElement>();
  const [selected, setSelected] = useState(active);
  const [refreshing, setRefreshing] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState("");
  const supportsSpeech = typeof window !== "undefined" && "speechSynthesis" in window;

  useEffect(() => {
    setSelected(active);
  }, [active]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (form) {
        setForm(null);
        setActionError("");
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [form, onClose]);

  const info =
    data.instances.find((item) => item.id === selected) ??
    data.instances.find((item) => item.id === active) ??
    data.instances[0];
  const caps = info
    ? mergeDeviceCapabilities(info.capabilities ?? [], supportsSpeech)
    : [];

  const refresh = async () => {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };

  const startNew = () => {
    setActionError("");
    setForm(newForm());
  };

  const startEdit = (item: Instance) => {
    setActionError("");
    setForm({
      original: item.id,
      name: item.name,
      transport: item.transport,
      url: item.url ?? "",
      ssh: item.ssh ?? "",
      dir: item.defaultDirectory ?? "",
      password: "",
      passwordFile: "",
    });
  };

  const save = async () => {
    if (!form) return;
    const name = form.name.trim();
    const url = form.url.trim();
    const ssh = form.ssh.trim();
    const dir = form.dir.trim();
    const passwordFile = form.passwordFile.trim();
    const invalid =
      !name
        ? "Name is required."
        : form.transport === "url" && !url
          ? "URL is required."
          : form.transport === "ssh" && !ssh
            ? "SSH host is required."
            : "";
    if (invalid) {
      setActionError(invalid);
      return;
    }
    const input: InstanceInput = {
      original: form.original,
      name,
      transport: form.transport,
    };
    if (form.transport === "url") {
      input.url = url;
      if (form.password) input.password = form.password;
    }
    if (form.transport === "ssh") input.ssh = ssh;
    if (dir) input.dir = dir;
    if (passwordFile) input.passwordFile = passwordFile;
    setSaving(true);
    setActionError("");
    try {
      await api.saveInstance(input);
      await onRefresh();
      setForm(null);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Could not save instance");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (item: Instance) => {
    if (
      !window.confirm(
        `Delete instance ${item.name}? Drafts and hidden chats stay in ui-state.json.`,
      )
    )
      return;
    setActionError("");
    try {
      await api.deleteInstance(item.id);
      setSelected((current) => (current === item.id ? active : current));
      await onRefresh();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Could not delete instance");
    }
  };

  const cancelForm = () => {
    setForm(null);
    setActionError("");
  };

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
        <div className="border-border flex items-center justify-between gap-2 border-b px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Server className="size-4" />
            Instances
          </h2>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" onClick={startNew}>
              <Plus />
              New instance
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close instances">
              <X />
            </Button>
          </div>
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
                onClick={() => {
                  setSelected(item.id);
                  cancelForm();
                }}
                className={cn(
                  "flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left",
                  selected === item.id && !form ? "bg-accent" : "hover:bg-accent/60",
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
                    {item.opencode?.version ? ` · OpenCode ${item.opencode.version}` : ""}
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
            {form ? (
              <div className="space-y-3 p-4">
                <h3 className="text-sm font-semibold">
                  {form.original ? "Edit instance" : "New instance"}
                </h3>

                <Field label="Name">
                  <Input
                    value={form.name}
                    onChange={(event) => setForm({ ...form, name: event.target.value })}
                    placeholder="work"
                    autoFocus
                  />
                </Field>

                <Field label="Transport">
                  <Select
                    value={form.transport}
                    onChange={(event) =>
                      setForm({ ...form, transport: event.target.value as InstanceTransport })
                    }
                    className="w-full"
                  >
                    <option value="local">Local (auto)</option>
                    <option value="url">URL</option>
                    <option value="ssh">SSH</option>
                  </Select>
                </Field>

                {form.transport === "url" && (
                  <Field label="URL">
                    <Input
                      value={form.url}
                      onChange={(event) => setForm({ ...form, url: event.target.value })}
                      placeholder="http://127.0.0.1:4096"
                    />
                  </Field>
                )}

                {form.transport === "ssh" && (
                  <Field label="SSH host">
                    <Input
                      value={form.ssh}
                      onChange={(event) => setForm({ ...form, ssh: event.target.value })}
                      placeholder="user@host"
                    />
                  </Field>
                )}

                <Field label="Default directory (optional)">
                  <Input
                    value={form.dir}
                    onChange={(event) => setForm({ ...form, dir: event.target.value })}
                    placeholder="/absolute/path"
                  />
                </Field>

                {form.transport === "url" && (
                  <Field label="Password">
                    <Input
                      type="password"
                      value={form.password}
                      onChange={(event) => setForm({ ...form, password: event.target.value })}
                      placeholder="Leave blank to keep the current password"
                    />
                  </Field>
                )}

                {(form.transport === "url" || form.transport === "ssh") && (
                  <Field label="Password file (optional)">
                    <Input
                      value={form.passwordFile}
                      onChange={(event) => setForm({ ...form, passwordFile: event.target.value })}
                      placeholder="Path on the host"
                    />
                  </Field>
                )}

                {actionError && (
                  <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-md border px-2.5 py-1.5 text-[11px]">
                    {actionError}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" onClick={() => void save()} disabled={saving}>
                    {saving ? "Saving…" : "Save"}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={cancelForm}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : info ? (
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

                {actionError && (
                  <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-md border px-2.5 py-1.5 text-[11px]">
                    {actionError}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => startEdit(info)}>
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:bg-destructive/10"
                    onClick={() => void remove(info)}
                  >
                    Delete
                  </Button>
                  {info.id !== active && (
                    <Button size="sm" onClick={() => onSelect(info.id)}>
                      Switch
                    </Button>
                  )}
                  {(info.state === "offline" || info.state === "unknown") && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void refresh()}
                      disabled={refreshing}
                    >
                      <RefreshCw className={refreshing ? "animate-spin" : undefined} />
                      {refreshing ? "Checking…" : "Reconnect"}
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

        <div className="border-border text-muted-foreground flex justify-between gap-2 border-t px-4 py-3 font-mono text-[10px]">
          <span className="truncate">
            Config: {data.configPath || "~/.config/nit-gui/instances.json"}
          </span>
          <span className="shrink-0">on {data.app.host}</span>
        </div>
      </div>
    </div>
  );
}
