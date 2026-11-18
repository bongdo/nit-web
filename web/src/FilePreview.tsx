import { useEffect, useState } from "react";
import { Download, FileCode2, Loader2, TriangleAlert } from "lucide-react";
import { api } from "./lib/api";
import { appLinkClick } from "./lib/appLink";
import { peroHref } from "./lib/diff";
import { messageOf } from "./lib/errors";
import { executablePath, rawHref } from "./lib/fileLink";
import { basename } from "./lib/format";
import { FileTypeIcon } from "./components/Attachment";
import { CodeBlock } from "./components/CodeBlock";
import { HtmlPreview } from "./components/HtmlPreview";
import { MarkdownLazy } from "./components/MarkdownLazy";
import { buttonVariants } from "./components/ui/button";

const MARKDOWN = /^(md|markdown|mdown)$/;
const HTML = /^(html?|xhtml)$/;
const EXTERNAL_ASSET =
  /<(?:script|link|img|source|video|audio)\b[^>]*\b(?:src|href)\s*=\s*["'](?:\/|https?:|\.{1,2}\/)/i;

type Preview =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "markdown"; text: string }
  | { kind: "html"; text: string }
  | { kind: "code"; text: string; language?: string }
  | { kind: "image" | "pdf" | "audio" | "video"; url: string }
  | { kind: "binary"; url: string; note?: string };

const PREVIEW_LIMIT = 2 << 20;

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

export default function FilePreview() {
  const params = new URLSearchParams(window.location.search);
  const path = params.get("path") ?? "";
  const [peroURL, setPeroURL] = useState("");
  const [preview, setPreview] = useState<Preview>({ kind: "loading" });

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
    load().catch((error: unknown) => {
      if (!controller.signal.aborted) {
        setPreview({ kind: "error", message: messageOf(error, "Could not read the file") });
      }
    });
    return () => controller.abort();
  }, [path]);

  const pero = peroURL ? peroHref(peroURL, path) : "";

  return (
    <div className="bg-background text-foreground flex h-dvh flex-col overflow-hidden">
      <header className="border-border bg-background/85 flex shrink-0 items-center gap-2 border-b px-3 py-2 backdrop-blur">
        <FileTypeIcon
          name={path}
          executable={executablePath(path)}
          className="text-muted-foreground size-4 shrink-0"
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{basename(path) || "Preview"}</div>
          <div className="text-muted-foreground truncate font-mono text-[11px]">{path}</div>
        </div>
        {pero && (
          <a
            href={pero}
            target="_blank"
            rel="noreferrer"
            onClick={appLinkClick({ app: "pero", path }, pero)}
            title={`Edit ${path} in pero`}
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            <FileCode2 />
            Edit in pero
          </a>
        )}
      </header>
      {preview.kind === "html" && EXTERNAL_ASSET.test(preview.text) && (
        <div className="border-border bg-muted/40 text-muted-foreground flex shrink-0 items-center gap-2 border-b px-3 py-1.5 text-[11px]">
          <TriangleAlert className="size-3.5 shrink-0" />
          External files are blocked in the sandboxed page. Edit in pero or publish it with
          drop.
        </div>
      )}
      <main className="min-h-0 flex-1 overflow-auto">
        {preview.kind === "loading" && (
          <div className="text-muted-foreground flex h-full items-center justify-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin" />
            Loading…
          </div>
        )}
        {preview.kind === "error" && (
          <div className="text-destructive flex h-full items-center justify-center gap-2 px-4 text-sm">
            <TriangleAlert className="size-4 shrink-0" />
            {preview.message}
          </div>
        )}
        {preview.kind === "markdown" && (
          <div className="mx-auto w-full max-w-3xl px-4 py-6">
            <MarkdownLazy
              text={preview.text}
              directory={directoryOf(path)}
              peroURL={peroURL || null}
            />
          </div>
        )}
        {preview.kind === "html" && (
          <HtmlPreview
            source={preview.text}
            fill
            className="h-full rounded-none border-0"
          />
        )}
        {preview.kind === "code" && (
          <div className="mx-auto w-full max-w-5xl px-4 py-6">
            <CodeBlock code={preview.text} language={preview.language} className="my-0" />
          </div>
        )}
        {preview.kind === "image" && (
          <div className="flex h-full items-center justify-center p-4">
            <img
              src={preview.url}
              alt={basename(path)}
              className="border-border max-h-full max-w-full rounded-md border object-contain"
            />
          </div>
        )}
        {preview.kind === "pdf" && (
          <iframe src={preview.url} title={basename(path)} className="h-full w-full border-0" />
        )}
        {preview.kind === "audio" && (
          <div className="mx-auto w-full max-w-2xl p-6">
            <audio controls src={preview.url} className="w-full" />
          </div>
        )}
        {preview.kind === "video" && (
          <div className="flex h-full items-center justify-center p-4">
            <video controls src={preview.url} className="max-h-full max-w-full rounded-md" />
          </div>
        )}
        {preview.kind === "binary" && (
          <div className="flex h-full items-center justify-center p-6">
            <div className="border-border bg-card flex max-w-md flex-col items-center gap-3 rounded-lg border p-6 text-center">
              <FileTypeIcon name={path} className="text-muted-foreground size-8" />
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
        )}
      </main>
    </div>
  );
}
