import { useState } from "react";
import {
  Download,
  FileArchive,
  FileAudio,
  FileCode,
  FileIcon,
  FileImage,
  FileJson,
  FileKey,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Presentation,
} from "lucide-react";
import { fileType } from "../lib/attachments";
import { formatBytes } from "../lib/format";
import { cn } from "../lib/utils";

export function FileTypeIcon({
  name,
  mime,
  className,
}: {
  name?: string;
  mime?: string;
  className?: string;
}) {
  const type = fileType({ name, mime });
  const Icon =
    type === "image"
      ? FileImage
      : type === "pdf" || type === "document"
        ? FileText
        : type === "audio"
          ? FileAudio
          : type === "video"
            ? FileVideo
            : type === "archive"
              ? FileArchive
              : type === "spreadsheet"
                ? FileSpreadsheet
                : type === "presentation"
                  ? Presentation
                  : type === "json"
                    ? FileJson
                    : type === "code"
                      ? FileCode
                      : type === "key"
                        ? FileKey
                        : FileIcon;
  return <Icon className={cn("size-3.5", className)} aria-hidden />;
}

function PdfPreview({ href, name }: { href: string; name: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-border bg-background/60 col-span-2 overflow-hidden rounded-md border">
      <div className="flex items-center gap-2 px-2 py-1 text-[11px]">
        <FileTypeIcon name={name} mime="application/pdf" />
        <span className="min-w-0 flex-1 truncate">{name}</span>
        <span className="text-muted-foreground shrink-0 uppercase">PDF</span>
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          className="hover:bg-accent shrink-0 rounded px-1 py-0.5"
        >
          {open ? "Hide" : "Preview"}
        </button>
        <a
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          className="hover:bg-accent shrink-0 rounded px-1 py-0.5"
        >
          Open
        </a>
      </div>
      {open && <iframe src={href} title={name} className="border-border h-96 w-full border-t" />}
    </div>
  );
}

export function AttachmentPreview({
  name,
  href,
  mime,
  bytes,
}: {
  name: string;
  href: string;
  mime?: string;
  bytes?: number;
}) {
  const type = fileType({ name, mime });
  if (type === "image") {
    return (
      <a href={href} target="_blank" rel="noreferrer noopener" className="block">
        <img
          src={href}
          alt={name}
          loading="lazy"
          className="border-border max-h-56 w-full rounded-md border object-cover"
        />
      </a>
    );
  }
  if (type === "pdf") return <PdfPreview href={href} name={name} />;
  if (type === "audio") {
    return (
      <div className="border-border bg-background/60 col-span-2 overflow-hidden rounded-md border">
        <div className="flex items-center gap-2 px-2 py-1 text-[11px]">
          <FileTypeIcon name={name} mime={mime} />
          <span className="min-w-0 flex-1 truncate">{name}</span>
          <a
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            className="hover:bg-accent shrink-0 rounded px-1 py-0.5"
          >
            Open
          </a>
        </div>
        <audio controls preload="metadata" src={href} className="w-full px-2 pb-2" />
      </div>
    );
  }
  if (type === "video") {
    return (
      <div className="border-border bg-background/60 col-span-2 overflow-hidden rounded-md border">
        <div className="flex items-center gap-2 px-2 py-1 text-[11px]">
          <FileTypeIcon name={name} mime={mime} />
          <span className="min-w-0 flex-1 truncate">{name}</span>
          <a
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            className="hover:bg-accent shrink-0 rounded px-1 py-0.5"
          >
            Open
          </a>
        </div>
        <video controls preload="metadata" src={href} className="max-h-72 w-full bg-black" />
      </div>
    );
  }
  return (
    <a
      href={href}
      download={name}
      target="_blank"
      rel="noreferrer noopener"
      className="border-border bg-background/60 flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px]"
    >
      <FileTypeIcon name={name} mime={mime} />
      <span className="min-w-0 flex-1 truncate">{name}</span>
      {bytes ? (
        <span className="text-muted-foreground shrink-0">{formatBytes(bytes)}</span>
      ) : null}
      <Download className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
    </a>
  );
}
