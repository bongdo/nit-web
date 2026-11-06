import type { UserFile } from "./types";
import { fileUri } from "./format";

export type AttachmentKind = "image" | "pdf" | "text" | "other";

const textExtensions =
  /\.(txt|md|markdown|csv|tsv|json|jsonl|xml|html?|css|jsx?|tsx?|go|py|sh|bash|zsh|ya?ml|toml|log|ini|conf|sql|rs|java|c|cpp|h|hpp)$/i;

export function attachmentKind(file: { name?: string; mime?: string }): AttachmentKind {
  const mime = file.mime?.toLowerCase() ?? "";
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("text/")) return "text";
  const name = file.name ?? "";
  if (/\.(png|jpe?g|gif|webp|svg|avif|bmp|heic|heif)$/i.test(name)) return "image";
  if (/\.pdf$/i.test(name)) return "pdf";
  if (textExtensions.test(name)) return "text";
  return "other";
}

export function attachmentHref(file: UserFile): string | undefined {
  const uri = fileUri(file);
  if (uri) {
    if (/^(data|blob):/i.test(uri) || /^https?:/i.test(uri)) return uri;
    return `/api/file?path=${encodeURIComponent(uri)}`;
  }
  if (file.data && file.mime) return `data:${file.mime};base64,${file.data}`;
  return undefined;
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
