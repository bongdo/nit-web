import { useEffect, useState } from "react";
import { Download, Loader2, Sparkles, TriangleAlert } from "lucide-react";
import { api } from "./lib/api";
import { parseDelimited } from "./lib/csv";
import { messageOf } from "./lib/errors";
import { annotatable, executablePath, rawHref, viewHref } from "./lib/fileLink";
import { basename, formatBytes } from "./lib/format";
import { wasmInfo, type WasmInfo } from "./lib/wasm";
import { FileTypeIcon } from "./components/Attachment";
import { AnnotationComposer, AnnotationSurface, placeAnnotation, type AnnotationPick } from "./components/Annotations";
import { CodeBlock } from "./components/CodeBlock";
import { HtmlPreview, type HtmlAnnotation } from "./components/HtmlPreview";
import { MarkdownLazy } from "./components/MarkdownLazy";
import { buttonVariants } from "./components/ui/button";

const MARKDOWN = /^(md|markdown|mdown)$/;
const HTML = /^(html?|xhtml)$/;
const TABLE = /^(csv|tsv)$/;
const JSON_TEXT = /^(json|jsonl)$/;
const STRUCTURED = /^(sql|ya?ml|toml|ini|conf|xml|wat)$/;
const PREVIEW_LIMIT = 2 << 20;
const WASM_LIMIT = 20 << 20;
const MAX_ROWS = 1000;
const MAX_COLUMNS = 50;

type Preview =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "markdown"; text: string }
  | { kind: "html"; text: string }
  | { kind: "code"; text: string; language?: string }
  | { kind: "table"; rows: string[][]; truncated: boolean }
  | { kind: "wasm"; info: WasmInfo; url: string }
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

function prettyJson(text: string, lines: boolean): string {
  if (!lines) {
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text;
    }
  }
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      try {
        return JSON.stringify(JSON.parse(line), null, 2);
      } catch {
        return line;
      }
    })
    .join("\n");
}

function limitTable(rows: string[][]): { rows: string[][]; truncated: boolean } {
  let truncated = rows.length > MAX_ROWS;
  const next = rows.slice(0, MAX_ROWS).map((row) => {
    if (row.length > MAX_COLUMNS) {
      truncated = true;
      return row.slice(0, MAX_COLUMNS);
    }
    return row;
  });
  return { rows: next, truncated };
}

function annotationText(path: string, pick: AnnotationPick, comment: string): string {
  const quote = pick.text ? ` «${pick.text}»` : "";
  return `In \`${path}\`, ${pick.locator}${quote}: ${comment}`;
}

function TableView({ rows, truncated }: { rows: string[][]; truncated: boolean }) {
  const [head, ...body] = rows;
  if (!head) {
    return <div className="text-muted-foreground p-6 text-sm">Empty table.</div>;
  }
  const columns = Math.max(head.length, ...body.map((row) => row.length));
  return (
    <div className="mx-auto w-full max-w-6xl p-4">
      <div className="border-border scrollbar-thin max-h-[calc(100dvh-2rem)] overflow-auto rounded-lg border">
        <table className="w-full border-collapse text-left text-xs">
          <thead className="bg-card sticky top-0 z-10">
            <tr>
              {Array.from({ length: columns }, (_, column) => (
                <th
                  key={column}
                  className="border-border border-b px-2 py-1.5 font-medium whitespace-nowrap"
                >
                  {head[column] ?? ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((row, index) => (
              <tr key={index} className="hover:bg-muted/40">
                {Array.from({ length: columns }, (_, column) => (
                  <td key={column} className="border-border border-b px-2 py-1 align-top">
                    {row[column] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {truncated && (
        <div className="text-muted-foreground mt-2 text-[11px]">
          Showing the first {MAX_ROWS} rows and {MAX_COLUMNS} columns.
        </div>
      )}
    </div>
  );
}

function WasmView({ info, url }: { info: WasmInfo; url: string }) {
  return (
    <div className="mx-auto w-full max-w-3xl p-6">
      <div className="border-border bg-card rounded-lg border p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-medium">WebAssembly module</div>
            <div className="text-muted-foreground text-xs">
              version {info.version} · {formatBytes(info.size)} · {info.sections.length} sections
            </div>
          </div>
          <a href={url} download className={buttonVariants({ variant: "secondary", size: "sm" })}>
            <Download />
            Download
          </a>
        </div>
        <table className="mt-4 w-full border-collapse text-left text-xs">
          <thead>
            <tr className="text-muted-foreground">
              <th className="border-border border-b px-2 py-1.5 font-medium">Section</th>
              <th className="border-border border-b px-2 py-1.5 font-medium">Size</th>
              <th className="border-border border-b px-2 py-1.5 font-medium">Offset</th>
            </tr>
          </thead>
          <tbody>
            {info.sections.map((section, index) => (
              <tr key={`${section.id}-${section.offset}-${index}`}>
                <td className="border-border border-b px-2 py-1 font-mono">{section.name}</td>
                <td className="border-border border-b px-2 py-1 tabular-nums">
                  {formatBytes(section.size)}
                </td>
                <td className="border-border border-b px-2 py-1 font-mono tabular-nums">
                  {section.offset}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function FilePreview() {
  const params = new URLSearchParams(window.location.search);
  const path = params.get("path") ?? "";
  const session = params.get("session") ?? "";
  const agentMode = params.get("mode") === "agent" && session !== "" && annotatable(path);
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
      if (ext === "svg") {
        const text = await readText(url, controller.signal);
        setPreview({ kind: "image", url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}` });
        return;
      }
      if (TABLE.test(ext)) {
        const text = await readText(url, controller.signal);
        const rows = parseDelimited(text, ext === "tsv" ? "\t" : ",");
        setPreview({ kind: "table", ...limitTable(rows) });
        return;
      }
      if (JSON_TEXT.test(ext)) {
        const text = await readText(url, controller.signal);
        setPreview({
          kind: "code",
          text: prettyJson(text, ext === "jsonl"),
          language: ext,
        });
        return;
      }
      if (STRUCTURED.test(ext)) {
        setPreview({
          kind: "code",
          text: await readText(url, controller.signal),
          language: ext,
        });
        return;
      }
      if (ext === "wasm") {
        if (size > WASM_LIMIT) {
          setPreview({ kind: "binary", url, note: "File is too large to inspect." });
          return;
        }
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error(`Could not read the file (${response.status})`);
        const info = wasmInfo(await response.arrayBuffer());
        setPreview(
          info
            ? { kind: "wasm", info, url }
            : { kind: "binary", url, note: "Not a WebAssembly module." },
        );
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
    ) : preview.kind === "table" ? (
      <AnnotationSurface enabled={agentMode} onPick={setPick} className="min-h-dvh">
        <TableView rows={preview.rows} truncated={preview.truncated} />
      </AnnotationSurface>
    ) : preview.kind === "wasm" ? (
      <WasmView info={preview.info} url={preview.url} />
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
