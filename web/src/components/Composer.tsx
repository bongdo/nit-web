import { useEffect, useRef, useState } from "react";
import { ArrowUp, FileIcon, Loader2, Mic, Paperclip, Square, Undo2, X } from "lucide-react";
import type { Session } from "../lib/types";
import { encodeWav } from "../lib/audio";
import { api } from "../lib/api";
import { formatBytes, formatCost, formatTokens } from "../lib/format";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";

export type Attachment = {
  id: string;
  name: string;
  size: number;
  path?: string;
  preview?: string;
  error?: string;
};

export type ComposerCommand = {
  id: string;
  label: string;
  description: string;
};

const MAX_UPLOAD = 25 << 20;
const MAX_RECORDING = 120;

function attachmentId() {
  return `att-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function Composer({
  session,
  workspace,
  disabled,
  running,
  modelName,
  focusKey,
  draft,
  commands,
  canUndo,
  onSend,
  onStop,
  onCommand,
  onRevertLast,
  onError,
}: {
  session: Session | null;
  workspace: string | null;
  disabled?: boolean;
  running?: boolean;
  modelName?: string;
  focusKey?: string | null;
  draft?: { text: string; id: number } | null;
  commands: ComposerCommand[];
  canUndo?: boolean;
  onSend: (text: string, attachments: Attachment[]) => Promise<void>;
  onStop: () => void;
  onCommand: (id: string) => void;
  onRevertLast: () => void;
  onError: (message: string) => void;
}) {
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [dropActive, setDropActive] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [commandIndex, setCommandIndex] = useState(0);
  const [commandDismissed, setCommandDismissed] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const audio = useRef<{
    context: AudioContext;
    stream: MediaStream;
    source: MediaStreamAudioSourceNode;
    processor: ScriptProcessorNode;
    gain: GainNode;
    chunks: Float32Array[];
    timer: number;
    started: number;
  } | null>(null);

  useEffect(() => {
    if (focusKey) ref.current?.focus();
  }, [focusKey]);

  useEffect(
    () => () => {
      const state = audio.current;
      if (!state) return;
      window.clearInterval(state.timer);
      for (const track of state.stream.getTracks()) track.stop();
      void state.context.close().catch(() => undefined);
    },
    [],
  );

  useEffect(() => {
    if (!draft) return;
    setValue(draft.text);
    requestAnimationFrame(() => {
      const area = ref.current;
      if (!area) return;
      area.focus();
      area.setSelectionRange(area.value.length, area.value.length);
    });
  }, [draft]);

  useEffect(() => {
    const area = ref.current;
    if (!area) return;
    area.style.height = "0px";
    area.style.height = `${Math.min(area.scrollHeight, 200)}px`;
  }, [value]);

  useEffect(() => {
    setCommandIndex(0);
    setCommandDismissed(false);
  }, [value]);

  const appendText = (text: string) => {
    const clean = text.trim();
    if (!clean) return;
    setValue((current) => {
      if (!current) return clean;
      return /\s$/.test(current) ? `${current}${clean}` : `${current} ${clean}`;
    });
    requestAnimationFrame(() => {
      const area = ref.current;
      if (!area) return;
      area.focus();
      area.setSelectionRange(area.value.length, area.value.length);
      area.scrollTop = area.scrollHeight;
    });
  };

  const addFiles = (files: File[]) => {
    if (!workspace) {
      onError("Choose a workspace before attaching files.");
      return;
    }
    for (const file of files) {
      if (file.size > MAX_UPLOAD) {
        onError(`${file.name} is larger than ${formatBytes(MAX_UPLOAD)}.`);
        continue;
      }
      const id = attachmentId();
      const preview = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined;
      setAttachments((current) => [
        ...current,
        { id, name: file.name || "file", size: file.size, preview },
      ]);
      void api
        .upload(file, workspace)
        .then((result) => {
          setAttachments((current) =>
            current.map((item) =>
              item.id === id ? { ...item, path: result.path, name: result.name } : item,
            ),
          );
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : "Upload failed";
          setAttachments((current) =>
            current.map((item) => (item.id === id ? { ...item, error: message } : item)),
          );
          onError(message);
        });
    }
  };

  const removeAttachment = (id: string) => {
    setAttachments((current) => {
      const found = current.find((item) => item.id === id);
      if (found?.preview) URL.revokeObjectURL(found.preview);
      return current.filter((item) => item.id !== id);
    });
  };

  const stopDictation = async () => {
    const state = audio.current;
    if (!state) return;
    audio.current = null;
    window.clearInterval(state.timer);
    setRecording(false);
    for (const track of state.stream.getTracks()) track.stop();
    state.source.disconnect();
    state.processor.disconnect();
    state.gain.disconnect();
    const rate = state.context.sampleRate;
    await state.context.close().catch(() => undefined);
    try {
      const blob = encodeWav(state.chunks, rate);
      const { text } = await api.stt(blob);
      appendText(text);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Transcription failed");
    }
  };

  const startDictation = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      onError("This browser does not expose a microphone API.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      const context = new AudioContext();
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(4096, 1, 1);
      const gain = context.createGain();
      gain.gain.value = 0;
      const chunks: Float32Array[] = [];
      processor.onaudioprocess = (event) => {
        chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      };
      source.connect(processor);
      processor.connect(gain);
      gain.connect(context.destination);
      const started = Date.now();
      const timer = window.setInterval(() => {
        const seconds = Math.floor((Date.now() - started) / 1000);
        setElapsed(seconds);
        if (seconds >= MAX_RECORDING) void stopDictation();
      }, 500);
      audio.current = { context, stream, source, processor, gain, chunks, timer, started };
      setElapsed(0);
      setRecording(true);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Microphone access was denied.");
    }
  };

  const toggleDictation = () => {
    if (recording) void stopDictation();
    else void startDictation();
  };

  const uploading = attachments.some((item) => !item.path && !item.error);
  const readyFiles = attachments.filter((item) => item.path && !item.error);

  const submit = async () => {
    const text = value.trim();
    if (!text || !workspace || disabled || running || submitting || uploading) return;
    setSubmitting(true);
    try {
      await onSend(text, readyFiles);
      setValue("");
      for (const item of attachments) {
        if (item.preview) URL.revokeObjectURL(item.preview);
      }
      setAttachments([]);
    } catch {
      return;
    } finally {
      setSubmitting(false);
    }
  };

  const query = value.startsWith("/") && !value.includes("\n") ? value.slice(1) : null;
  const matches =
    query !== null && !query.includes(" ")
      ? commands.filter((item) => item.id.startsWith(query.toLowerCase()))
      : [];
  const paletteOpen = matches.length > 0 && !commandDismissed && !recording;
  const selectedCommand = matches[Math.min(commandIndex, Math.max(0, matches.length - 1))];

  const runCommand = (id: string) => {
    if (id === "clear") {
      setValue("");
      return;
    }
    setValue("");
    setCommandDismissed(true);
    onCommand(id);
  };

  const tokens = session?.tokens;

  return (
    <div className="border-border bg-background/95 supports-[backdrop-filter]:bg-background/80 shrink-0 border-t backdrop-blur">
      <div className="mx-auto w-full max-w-3xl px-4 pt-3 pb-2">
        <div
          className={cn(
            "border-border bg-card focus-within:border-ring focus-within:ring-ring/20 relative rounded-xl border shadow-sm transition-shadow focus-within:ring-[3px]",
            disabled && "opacity-60",
            dropActive && "border-ring ring-ring/30 ring-[3px]",
          )}
          onDragOver={(event) => {
            event.preventDefault();
            setDropActive(true);
          }}
          onDragLeave={() => setDropActive(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDropActive(false);
            if (event.dataTransfer.files.length > 0) addFiles(Array.from(event.dataTransfer.files));
          }}
        >
          {paletteOpen && (
            <div className="border-border bg-popover absolute inset-x-2 bottom-full z-20 mb-2 max-h-64 overflow-y-auto rounded-lg border p-1 shadow-lg">
              {matches.map((item, index) => (
                <button
                  key={item.id}
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    runCommand(item.id);
                  }}
                  className={cn(
                    "flex w-full items-baseline gap-2 rounded px-2 py-1.5 text-left",
                    index === commandIndex ? "bg-accent" : "hover:bg-accent/60",
                  )}
                >
                  <span className="font-mono text-xs">/{item.id}</span>
                  <span className="text-muted-foreground truncate text-[11px]">
                    {item.description}
                  </span>
                </button>
              ))}
            </div>
          )}

          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-3 pt-2">
              {attachments.map((item) => (
                <span
                  key={item.id}
                  className={cn(
                    "border-border bg-muted/40 flex max-w-full items-center gap-1.5 rounded-md border px-1.5 py-1 text-[11px]",
                    item.error && "border-destructive/50",
                  )}
                  title={item.error ?? item.name}
                >
                  {item.preview ? (
                    <img src={item.preview} alt="" className="size-5 rounded object-cover" />
                  ) : (
                    <FileIcon className="text-muted-foreground size-3.5" />
                  )}
                  <span className="max-w-40 truncate">{item.name}</span>
                  <span className="text-muted-foreground">{formatBytes(item.size)}</span>
                  {!item.path && !item.error && <Loader2 className="size-3 animate-spin" />}
                  <button
                    type="button"
                    onClick={() => removeAttachment(item.id)}
                    aria-label={`Remove ${item.name}`}
                    className="hover:bg-accent rounded p-0.5"
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          <Textarea
            ref={ref}
            rows={1}
            value={value}
            disabled={disabled || !workspace}
            aria-label="Message"
            placeholder={
              !workspace
                ? "Choose a workspace to start"
                : session
                  ? "Ask anything…  / for commands"
                  : "New chat in this workspace…"
            }
            className="scrollbar-thin max-h-[200px] min-h-[44px] overflow-y-auto px-4 py-3 text-[15px]"
            onChange={(event) => setValue(event.target.value)}
            onPaste={(event) => {
              const files = Array.from(event.clipboardData.files);
              if (files.length > 0) {
                event.preventDefault();
                addFiles(files);
              }
            }}
            onKeyDown={(event) => {
              if (paletteOpen) {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setCommandIndex((current) => (current + 1) % matches.length);
                  return;
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setCommandIndex((current) => (current - 1 + matches.length) % matches.length);
                  return;
                }
                if (event.key === "Enter" && !event.shiftKey && selectedCommand) {
                  event.preventDefault();
                  runCommand(selectedCommand.id);
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setCommandDismissed(true);
                  return;
                }
              }
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void submit();
              }
            }}
          />
          <div className="flex items-center gap-1 px-2.5 pb-2">
            <input
              ref={fileRef}
              type="file"
              multiple
              className="hidden"
              onChange={(event) => {
                if (event.target.files) addFiles(Array.from(event.target.files));
                event.target.value = "";
              }}
            />
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => fileRef.current?.click()}
              disabled={disabled || !workspace}
              title="Attach files"
              aria-label="Attach files"
            >
              <Paperclip />
            </Button>
            <Button
              variant={recording ? "destructive" : "ghost"}
              size={recording ? "sm" : "icon-sm"}
              onClick={toggleDictation}
              disabled={disabled || !workspace}
              title={recording ? "Stop dictation" : "Dictate"}
              aria-label={recording ? "Stop dictation" : "Dictate"}
            >
              {recording ? <Square className="fill-current" /> : <Mic />}
              {recording && <span className="font-mono text-[11px]">0:{String(elapsed).padStart(2, "0")}</span>}
            </Button>
            <span className="text-muted-foreground hidden text-[11px] sm:inline">
              Enter to send · Shift+Enter for a new line · / commands
            </span>
            <div className="ml-auto flex items-center gap-1">
              {canUndo && !running && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onRevertLast}
                  title="Revert the last message and edit it"
                >
                  <Undo2 />
                  Undo
                </Button>
              )}
              {running ? (
                <Button variant="secondary" size="sm" onClick={onStop} aria-label="Stop">
                  <Square className="fill-current" />
                  Stop
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={() => void submit()}
                  disabled={!workspace || disabled || !value.trim() || submitting || uploading}
                  aria-label="Send"
                >
                  {submitting ? <Loader2 className="animate-spin" /> : <ArrowUp />}
                  Send
                </Button>
              )}
            </div>
          </div>
        </div>
        {session && (
          <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 px-1 pt-2 text-[11px]">
            {modelName && <span className="truncate">{modelName}</span>}
            {tokens && (
              <span className="ml-auto">
                {formatTokens(tokens.input)} in · {formatTokens(tokens.output)} out
              </span>
            )}
            <span className={tokens ? "" : "ml-auto"}>{formatCost(session.cost)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
