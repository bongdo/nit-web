import { useState } from "react";
import { Check, CheckCheck, Loader2, ShieldAlert, X } from "lucide-react";
import type { PermissionDecision, PermissionRequest } from "../lib/types";
import { api } from "../lib/api";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

export function PermissionCard({
  permission,
  sessionID,
  onDone,
  onError,
}: {
  permission: PermissionRequest;
  sessionID: string;
  onDone: () => void;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState<PermissionDecision | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const reply = async (decision: PermissionDecision) => {
    setBusy(decision);
    setError(null);
    try {
      await api.replyPermission(
        sessionID,
        permission.id,
        decision,
        decision === "reject" ? reason.trim() || undefined : undefined,
      );
      onDone();
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : "Could not reply to the permission request.";
      setError(message);
      onError(message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      role="group"
      aria-label={`Permission request: ${permission.action}`}
      aria-busy={busy !== null}
      className="border-primary/30 bg-card mx-auto my-2 w-full max-w-3xl rounded-xl border p-3 shadow-sm"
    >
      <div className="flex items-start gap-2">
        <ShieldAlert className="text-primary mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold">{permission.action}</div>
          <div className="text-muted-foreground text-[10px]">The agent needs your permission.</div>
        </div>
      </div>

      {permission.resources.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {permission.resources.map((resource) => (
            <li
              key={resource}
              title={resource}
              className="bg-muted/50 truncate rounded px-1.5 py-1 font-mono text-[11px]"
            >
              {resource}
            </li>
          ))}
        </ul>
      )}

      {permission.message && (
        <p className="text-muted-foreground mt-2 text-[11px] leading-4">{permission.message}</p>
      )}

      <Input
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder="Reason for rejecting (optional)"
        aria-label="Reason for rejecting"
        className="mt-2 h-8 text-xs"
        disabled={busy !== null}
      />

      {error && <p className="text-destructive mt-2 text-[11px]">{error}</p>}

      <div className="mt-2 flex items-center justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void reply("reject")}
          disabled={busy !== null}
        >
          {busy === "reject" ? <Loader2 className="animate-spin" /> : <X />}
          Reject
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void reply("always")}
          disabled={busy !== null}
        >
          {busy === "always" ? <Loader2 className="animate-spin" /> : <CheckCheck />}
          Always
        </Button>
        <Button size="sm" onClick={() => void reply("once")} disabled={busy !== null}>
          {busy === "once" ? <Loader2 className="animate-spin" /> : <Check />}
          Allow once
        </Button>
      </div>
    </div>
  );
}
