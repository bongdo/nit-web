import { useEffect, useState } from "react";
import { CircleAlert, Loader2 } from "lucide-react";
import { api } from "../lib/api";
import { basename } from "../lib/format";
import { HtmlPreview } from "./HtmlPreview";

export function HtmlArtifact({
  sessionID,
  instance,
  path,
  title,
}: {
  sessionID: string;
  instance: string;
  path: string;
  title: string;
}) {
  const [state, setState] = useState<{ html?: string; error?: string }>({});

  useEffect(() => {
    let cancelled = false;
    setState({});
    api
      .artifact(sessionID, path, instance)
      .then((result) => {
        if (!cancelled) setState({ html: result.html });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({ error: error instanceof Error ? error.message : "Page unavailable" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [instance, path, sessionID]);

  if (state.error) {
    return (
      <div className="text-destructive border-destructive/30 bg-destructive/5 my-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs">
        <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
        <span className="min-w-0 break-words">
          Page {basename(path)} is not available: {state.error}
        </span>
      </div>
    );
  }

  return (
    <figure className="my-3">
      <figcaption className="text-muted-foreground mb-1.5 truncate text-[11px]">
        {title || basename(path)}
      </figcaption>
      {state.html === undefined ? (
        <div className="text-muted-foreground border-border bg-card/40 flex h-24 items-center justify-center gap-2 rounded-lg border text-xs">
          <Loader2 className="size-3.5 animate-spin" />
          Loading page…
        </div>
      ) : (
        <HtmlPreview source={state.html} title={title || basename(path)} />
      )}
    </figure>
  );
}
