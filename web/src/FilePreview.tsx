import { useEffect, useState } from "react";
import { Download, Loader2, Sparkles, TriangleAlert } from "lucide-react";
import { api } from "./lib/api";
import { messageOf } from "./lib/errors";
import { executablePath, rawHref, viewHref } from "./lib/fileLink";
import { basename } from "./lib/format";
import { FileTypeIcon } from "./components/Attachment";
import { AnnotationComposer, AnnotationSurface, placeAnnotation, type AnnotationPick } from "./components/Annotations";
import { CodeBlock } from "./components/CodeBlock";
import { HtmlPreview, type HtmlAnnotation } from "./components/HtmlPreview";
import { MarkdownLazy } from "./components/MarkdownLazy";
import { buttonVariants } from "./components/ui/button";

const MARKDOWN = /^(md|markdown|mdown)$/;
const HTML = /^(html?|xhtml)$/;
const PREVIEW_LIMIT = 2 << 20;

type Preview =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "markdown"; text: string }
  | { kind: "html"; text: string }
  | { kind: "code"; text: string; language?: string }
  | { kind: "image" | "pdf" | "audio" | "video"; url: string }
  | { kind: "binary"; url: string; note?: string };

function extension(path: string): string {
  const name = basename(path);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function directoryOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash > 0 ? path.slice(0, slash) : "/";
}

async function readText(url: string, signal: AbortSignal): Promise<string> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Could not read the file (${response.status})`);
  return response.text();
}

function annotationText(path: string, pick: AnnotationPick, comment: string): string {
  const quote = pick.text ? ` «${pick.text}»` : "";
  return `In \`${path}\`, ${pick.locator}${quote}: ${comment}`;
}

export default function FilePreview() {
  const params = new URLSearchParams(window.location.search);
  const path = params.get("path") ?? "";
  const session = params.get("session") ?? "";
  const agentMode = params.get("mode") === "agent" && session !== "";
  const [peroURL, setPeroURL] = useState("");
  const [preview, setPreview] = useState<Preview>({ kind: "loading" });
  const [pick, setPick] = useState<AnnotationPick | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(0);

  useEffect(() => {
    document.title = `${basename(path) || "Preview"} — nit-gui`;
  }, [path]);

  useEffect(() => {
    let cancelled = false;
    api
      .config()
      .then((config) => {
        if (!cancelled) setPeroURL(config.peroURL);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!path) {
      setPreview({ kind: "error", message: "No file path in the link." });
      return;
    }
    const controller = new AbortController();
    const url = rawHref(path);
    const ext = extension(path);
    const load = async () => {
      setPreview({ kind: "loading" });
      const head = await fetch(url, { method: "HEAD", signal: controller.signal });
      if (!head.ok) throw new Error(`Could not read the file (${head.status})`);
      const type = head.headers.get("content-type") ?? "";
      const size = Number(head.headers.get("content-length") ?? 0);
      const textLike = MARKDOWN.test(ext) || HTML.test(ext) || type.startsWith("text/");
      if (textLike && size > PREVIEW_LIMIT) {
        setPreview({ kind: "binary", url, note: "File is too large to preview." });
        return;
      }
      if (MARKDOWN.test(ext)) {
        setPreview({ kind: "markdown", text: await readText(url, controller.signal) });
        return;
      }
      if (HTML.test(ext)) {
        setPreview({ kind: "html", text: await readText(url, controller.signal) });
        return;
      }
      if (type.startsWith("image/")) {
        setPreview({ kind: "image", url });
        return;
      }
      if (type === "application/pdf") {
        setPreview({ kind: "pdf", url });
        return;
      }
      if (type.startsWith("audio/")) {
        setPreview({ kind: "audio", url });
        return;
      }
      if (type.startsWith("video/")) {
        setPreview({ kind: "video", url });
        return;
      }
      if (type.startsWith("text/")) {
        setPreview({ kind: "code", text: await readText(url, controller.signal), language: ext });
        return;
      }
      setPreview({ kind: "binary", url });
    };
    load().catch((cause: unknown) => {
      if (!controller.signal.aborted) {
        setPreview({ kind: "error", message: messageOf(cause, "Could not read the file") });
      }
    });
    return () => controller.abort();
  }, [path]);

  const onHtmlPick = (target: HtmlAnnotation) => {
    setPick({
      ...placeAnnotation(target.rect),
      locator: target.table || `element ${target.selector}`,
      text: target.text,
    });
  };

  const send = async (comment: string) => {
    if (!pick || !session) return;
    setSending(true);
    setError("");
    try {
      const text = annotationText(path, pick, comment);
      const instance = params.get("instance") ?? undefined;
      try {
        await api.prompt(session, text, undefined, "steer", undefined, instance);
      } catch {
        await api.prompt(session, text, undefined, undefined, undefined, instance);
      }
      setSent((count) => count + 1);
      setPick(null);
    } catch (cause) {
      setError(messageOf(cause, "Could not send the comment"));
    } finally {
      setSending(false);
    }
  };

  const content =
    preview.kind === "loading" ? (
      <div className="text-muted-foreground flex h-dvh items-center justify-center gap-2 text-sm">
        <Loader2 className="size-4 animate-spin" />
        Loading…
      </div>
    ) : preview.kind === "error" ? (
      <div className="text-destructive flex h-dvh items-center justify-center gap-2 px-4 text-sm">
        <TriangleAlert className="size-4 shrink-0" />
        {preview.message}
      </div>
    ) : preview.kind === "markdown" ? (
      <AnnotationSurface
        enabled={agentMode}
        onPick={setPick}
        className="mx-auto w-full max-w-3xl px-4 py-6"
      >
        <MarkdownLazy
          text={preview.text}
          directory={directoryOf(path)}
          peroURL={peroURL || "/pero/"}
          sessionID={session || undefined}
          instance={params.get("instance") ?? undefined}
        />
      </AnnotationSurface>
    ) : preview.kind === "html" ? (
      <HtmlPreview
        source={preview.text}
        fill
        annotate={agentMode}
        onAnnotate={onHtmlPick}
        className="h-dvh w-full rounded-none border-0"
      />
    ) : preview.kind === "code" ? (
      <AnnotationSurface enabled={agentMode} onPick={setPick} className="mx-auto max-w-5xl px-4 py-6">
        <CodeBlock code={preview.text} language={preview.language} className="my-0" />
      </AnnotationSurface>
    ) : preview.kind === "image" ? (
      <div className="flex h-dvh items-center justify-center p-4">
        <img
          src={preview.url}
          alt={basename(path)}
          className="border-border max-h-full max-w-full rounded-md border object-contain"
        />
      </div>
    ) : preview.kind === "pdf" ? (
      <iframe src={preview.url} title={basename(path)} className="h-dvh w-full border-0" />
    ) : preview.kind === "audio" ? (
      <div className="flex h-dvh items-center justify-center p-6">
        <audio controls src={preview.url} className="w-full max-w-2xl" />
      </div>
    ) : preview.kind === "video" ? (
      <div className="flex h-dvh items-center justify-center p-4">
        <video controls src={preview.url} className="max-h-full max-w-full rounded-md" />
      </div>
    ) : preview.kind === "binary" ? (
      <div className="flex h-dvh items-center justify-center p-6">
        <div className="border-border bg-card flex max-w-md flex-col items-center gap-3 rounded-lg border p-6 text-center">
          <FileTypeIcon
            name={path}
            executable={executablePath(path)}
            className="text-muted-foreground size-8"
          />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{basename(path)}</div>
            <div className="text-muted-foreground text-xs">
              {preview.note ?? "No preview for this file type."}
            </div>
          </div>
          <a
            href={preview.url}
            download
            className={buttonVariants({ variant: "secondary", size: "sm" })}
          >
            <Download />
            Download
          </a>
        </div>
      </div>
    ) : null;

  return (
    <div className="bg-background text-foreground min-h-dvh">
      {content}
      {agentMode && (
        <div className="border-border bg-popover/90 fixed right-3 bottom-3 z-40 flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] shadow-lg backdrop-blur">
          <Sparkles className="text-muted-foreground size-3.5" />
          <span>Agent edit</span>
          {sent > 0 && <span className="text-muted-foreground">{sent} sent</span>}
          <a
            href={viewHref(path, params.get("instance") ?? undefined)}
            className="text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
          >
            View only
          </a>
        </div>
      )}
      {agentMode && pick && (
        <AnnotationComposer
          pick={pick}
          sending={sending}
          error={error}
          onSend={(comment) => void send(comment)}
          onClose={() => {
            setPick(null);
            setError("");
          }}
        />
      )}
    </div>
  );
}
