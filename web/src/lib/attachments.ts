import type { UserFile } from "./types";
import { fileUri } from "./format";

export type AttachmentKind = "image" | "pdf" | "text" | "other";
export type FileType =
  | "image"
  | "pdf"
  | "audio"
  | "video"
  | "archive"
  | "spreadsheet"
  | "presentation"
  | "document"
  | "json"
  | "code"
  | "key"
  | "other";

const textExtensions =
  /\.(txt|md|markdown|csv|tsv|json|jsonl|xml|html?|css|jsx?|tsx?|go|py|sh|bash|zsh|ya?ml|toml|log|ini|conf|sql|rs|java|c|cpp|h|hpp)$/i;

const fileTypes: [FileType, RegExp][] = [
  ["image", /\.(png|jpe?g|gif|webp|svg|avif|bmp|heic|heif)$/i],
  ["pdf", /\.pdf$/i],
  ["audio", /\.(mp3|wav|ogg|oga|flac|m4a|aac|opus|wma)$/i],
  ["video", /\.(mp4|webm|mov|m4v|avi|mkv|ogv)$/i],
  ["archive", /\.(zip|rar|7z|tar|gz|tgz|bz2|xz)$/i],
  ["spreadsheet", /\.(csv|tsv|xls|xlsx|ods|numbers)$/i],
  ["presentation", /\.(ppt|pptx|odp|key)$/i],
  ["json", /\.(json|jsonl)$/i],
  ["code", /\.(js|jsx|ts|tsx|go|py|sh|bash|zsh|rs|java|c|cpp|h|hpp|cs|rb|php|swift|kt|kts|scala|sql|html?|css|scss|sass|less|xml|ya?ml|toml|ini|conf|env)$/i],
  ["key", /\.(pem|key|crt|cer|p12|pfx)$/i],
  ["document", /\.(txt|md|markdown|log|doc|docx|odt|rtf|pages)$/i],
];

export function fileType(file: { name?: string; mime?: string }): FileType {
  const mime = file.mime?.toLowerCase() ?? "";
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (mime === "application/json") return "json";
  if (mime.startsWith("text/csv") || mime.includes("spreadsheet") || mime.includes("excel"))
    return "spreadsheet";
  if (mime.includes("presentation") || mime.includes("powerpoint")) return "presentation";
  if (mime.includes("word") || mime === "application/rtf") return "document";
  if (
    mime === "application/zip" ||
    mime === "application/x-7z-compressed" ||
    mime === "application/x-rar-compressed" ||
    mime === "application/gzip" ||
    mime === "application/x-tar"
  )
    return "archive";
  const name = file.name ?? "";
  for (const [type, pattern] of fileTypes) {
    if (pattern.test(name)) return type;
  }
  if (mime.startsWith("text/")) return "document";
  return "other";
}

export function attachmentKind(file: { name?: string; mime?: string }): AttachmentKind {
  const type = fileType(file);
  if (type === "image") return "image";
  if (type === "pdf") return "pdf";
  if (textExtensions.test(file.name ?? "") || file.mime?.toLowerCase().startsWith("text/")) {
    return "text";
  }
  return "other";
}

export function attachmentNameFromHref(href: string): string {
  try {
    const parsed = new URL(href, "http://local");
    const raw = parsed.searchParams.get("path") ?? parsed.pathname;
    return decodeURIComponent(raw.split("/").filter(Boolean).pop() ?? "file");
  } catch {
    return "file";
  }
}

export function isLocalFileHref(href?: string): boolean {
  return Boolean(href && /^\/api\/file\?/i.test(href));
}

export function attachmentHref(file: UserFile): string | undefined {
  const uri = fileUri(file);
  const inline = file.data && file.mime ? `data:${file.mime};base64,${file.data}` : undefined;
  if (uri) {
    if (/^(data|blob):/i.test(uri) || /^https?:/i.test(uri)) return uri;
    if (/^file:/i.test(uri) && !uri.startsWith("file:///tmp/nit-gui-") && inline) return inline;
    return `/api/file?path=${encodeURIComponent(uri)}`;
  }
  return inline;
}

export function attachmentWarning(
  file: { name?: string; mime?: string },
  model?: { name: string; capabilities?: { input?: string[] } } | null,
): string | undefined {
  const input = model?.capabilities?.input;
  if (!input || input.length === 0) return undefined;
  const kind = attachmentKind(file);
  if (kind === "image" && !input.includes("image")) {
    return `${model.name} cannot read images.`;
  }
  if (kind === "pdf" && !input.includes("pdf")) {
    return `${model.name} cannot read PDFs. Choose a model with PDF input.`;
  }
  if (kind === "other") {
    return "The model reads text, images and PDFs. This file is uploaded but not sent.";
  }
  return undefined;
}
