import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Check,
  ChevronDown,
  FileIcon,
  Loader2,
  Mic,
  Paperclip,
  SpellCheck,
  Square,
  X,
} from "lucide-react";
import type { FormInfo, Session } from "../lib/types";
import { encodeWav } from "../lib/audio";
import { api } from "../lib/api";
import { questionField } from "../lib/forms";
import { formatBytes, quoteText } from "../lib/format";
import { applyIssue, issueKey, type SpellIssue } from "../lib/spell";
import { useSpellcheck } from "../hooks/useSpellcheck";
import { cn } from "../lib/utils";
import { COMPOSER_TEXT, ComposerHighlights } from "./ComposerHighlights";
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

function loadIgnoredWords(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem("nit-gui.spell-ignore") ?? "[]");
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
      : [];
  } catch {
    return [];
  }
}

export function Composer({
  session,
  workspace,
  disabled,
  running,
  focusKey,
  draft,
  insert,
  commands,
  dictationMode,
  spellcheck,
  form,
  onSend,
  onStop,
  onCommand,
  onError,
  onFormDone,
}: {
  session: Session | null;
  workspace: string | null;
  disabled?: boolean;
  running?: boolean;
  focusKey?: string | null;
  draft?: { text: string; id: number } | null;
  insert?: { text: string; id: number } | null;
  commands: ComposerCommand[];
  dictationMode: "fast" | "accurate";
  spellcheck: boolean;
  form?: FormInfo | null;
  onSend: (text: string, attachments: Attachment[], delivery?: "queue" | "steer") => Promise<void>;
  onStop: () => void;
  onCommand: (id: string) => void;
  onError: (message: string) => void;
  onFormDone: () => void;
}) {
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [dropActive, setDropActive] = useState(false);
  const [recording, setRecording] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [pending, setPending] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [commandIndex, setCommandIndex] = useState(0);
  const [commandDismissed, setCommandDismissed] = useState(false);
  const [spellOpen, setSpellOpen] = useState(false);
  const [ignored, setIgnored] = useState<string[]>(loadIgnoredWords);
  const [formOpen, setFormOpen] = useState(true);
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const draftBeforeForm = useRef("");
  const activeForm = useRef<string | null>(null);
  const question = form ? questionField(form) : null;
  const option = question?.options?.find((item) => item.value === value) ?? null;
  const answerText = option ? "" : value;
  const customAnswer = !question || (question.options?.length ?? 0) === 0 || question.custom !== false;
  const { issues, checking } = useSpellcheck(
    question && !customAnswer ? "" : answerText,
    spellcheck && !recording && !finishing,
    ignored,
  );
  const audio = useRef<{
    context: AudioContext;
    stream: MediaStream;
    source: MediaStreamAudioSourceNode;
    processor: ScriptProcessorNode;
    gain: GainNode;
    chunks: Float32Array[];
    segment: Float32Array[];
    preroll: Float32Array[];
    hasSpeech: boolean;
    silence: number;
    timer: number;
    started: number;
  } | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const pendingRef = useRef(0);

  useEffect(() => {
    if (focusKey) ref.current?.focus();
  }, [focusKey]);

  useEffect(() => {
    if (form && question) {
      if (activeForm.current === form.id) return;
      activeForm.current = form.id;
      setValue((current) => {
        draftBeforeForm.current = current;
        return typeof question.default === "string" ? question.default : "";
      });
      setFormOpen(true);
      setFormError(null);
      return;
    }
    if (!activeForm.current) return;
    activeForm.current = null;
    setValue(draftBeforeForm.current);
    setFormError(null);
  }, [form, question]);

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
    if (!insert) return;
    const quoted = quoteText(insert.text);
    setValue((current) =>
      current.trim() ? `${current.replace(/\s+$/, "")}\n\n${quoted}\n\n` : `${quoted}\n\n`,
    );
    requestAnimationFrame(() => {
      const area = ref.current;
      if (!area) return;
      area.focus();
      area.setSelectionRange(area.value.length, area.value.length);
      area.scrollTop = area.scrollHeight;
    });
  }, [insert]);

  useEffect(() => {
    const area = ref.current;
    if (!area) return;
    area.style.height = "auto";
    area.style.height = `${Math.min(area.scrollHeight, 200)}px`;
  }, [value]);

  useEffect(() => {
    if (!checking && issues.length === 0) setSpellOpen(false);
  }, [checking, issues.length]);

  useEffect(() => {
    const area = ref.current;
    const layer = highlightRef.current;
    if (!area || !layer) return;
    layer.scrollTop = area.scrollTop;
    layer.scrollLeft = area.scrollLeft;
  }, [value]);

  const syncScroll = () => {
    const area = ref.current;
    const layer = highlightRef.current;
    if (!area || !layer) return;
    layer.scrollTop = area.scrollTop;
    layer.scrollLeft = area.scrollLeft;
  };

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

  const applySuggestion = (issue: SpellIssue, replacement: string) => {
    setValue(applyIssue(answerText, issue, replacement));
    requestAnimationFrame(() => {
      const area = ref.current;
      if (!area) return;
      const position = issue.start + replacement.length;
      area.focus();
      area.setSelectionRange(position, position);
    });
  };

  const ignoreWord = (word: string) => {
    const clean = word.trim().toLowerCase();
    if (!clean) return;
    setIgnored((current) => {
      if (current.includes(clean)) return current;
      const next = [...current, clean];
      localStorage.setItem("nit-gui.spell-ignore", JSON.stringify(next));
      return next;
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

  const enqueueSegment = (chunks: Float32Array[], rate: number) => {
    if (chunks.length === 0) return;
    const blob = encodeWav(chunks, rate);
    pendingRef.current += 1;
    setPending(pendingRef.current);
    queue.current = queue.current
      .then(async () => {
        const { text } = await api.stt(blob, "fast");
        appendText(text);
      })
      .catch((error) => {
        onError(error instanceof Error ? error.message : "Transcription failed");
      })
      .finally(() => {
        pendingRef.current = Math.max(0, pendingRef.current - 1);
        setPending(pendingRef.current);
      });
  };

  const flushSegment = (state: NonNullable<typeof audio.current>) => {
    const chunks = state.segment;
    state.segment = [];
    state.hasSpeech = false;
    state.silence = 0;
    const seconds = chunks.reduce((total, chunk) => total + chunk.length, 0) / state.context.sampleRate;
    if (seconds < 0.3) return;
    enqueueSegment(chunks, state.context.sampleRate);
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
    setFinishing(true);
    try {
      if (dictationMode === "fast") {
        flushSegment(state);
        await queue.current;
      } else {
        const { text } = await api.stt(encodeWav(state.chunks, rate));
        appendText(text);
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : "Transcription failed");
    } finally {
      setFinishing(false);
      setPending(0);
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
      const state: NonNullable<typeof audio.current> = {
        context,
        stream,
        source,
        processor,
        gain,
        chunks,
        segment: [],
        preroll: [],
        hasSpeech: false,
        silence: 0,
        timer: 0,
        started: Date.now(),
      };
      processor.onaudioprocess = (event) => {
        const block = new Float32Array(event.inputBuffer.getChannelData(0));
        chunks.push(block);
        if (dictationMode !== "fast") return;
        let sum = 0;
        for (let index = 0; index < block.length; index += 1) sum += block[index] * block[index];
        const rms = Math.sqrt(sum / block.length);
        const speech = rms > 0.012;
        if (!state.hasSpeech) {
          state.preroll.push(block);
          if (state.preroll.length > 3) state.preroll.shift();
          if (speech) {
            state.hasSpeech = true;
            state.segment.push(...state.preroll);
            state.preroll = [];
            state.silence = 0;
          }
          return;
        }
        state.segment.push(block);
        if (speech) state.silence = 0;
        else state.silence += block.length / context.sampleRate;
        const seconds =
          state.segment.reduce((total, chunk) => total + chunk.length, 0) / context.sampleRate;
        if ((state.silence >= 0.6 && seconds >= 0.4) || seconds >= 6) {
          flushSegment(state);
        }
      };
      source.connect(processor);
      processor.connect(gain);
      gain.connect(context.destination);
      state.timer = window.setInterval(() => {
        const seconds = Math.floor((Date.now() - state.started) / 1000);
        setElapsed(seconds);
        if (seconds >= MAX_RECORDING) void stopDictation();
      }, 500);
      audio.current = state;
      setElapsed(0);
      setRecording(true);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Microphone access was denied.");
    }
  };

  const toggleDictation = () => {
    if (recording) void stopDictation();
    else if (!finishing) void startDictation();
  };

  const uploading = attachments.some((item) => !item.path && !item.error);
  const readyFiles = attachments.filter((item) => item.path && !item.error);

  const submit = async () => {
    const text = value.trim();
    if (!text || !workspace || disabled || submitting || uploading || finishing) return;
    setSubmitting(true);
    try {
      await onSend(text, readyFiles, running ? "queue" : undefined);
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

  const answerForm = async () => {
    if (!form || !question || !session) return;
    const answer = value.trim();
    if (question.required && !answer) {
      setFormError(`${question.title ?? question.key} is required.`);
      return;
    }
    setFormBusy(true);
    setFormError(null);
    try {
      await api.replyForm(session.id, form.id, answer ? { [question.key]: answer } : {});
      setValue("");
      onFormDone();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not submit the answer.";
      setFormError(message);
      onError(message);
    } finally {
      setFormBusy(false);
    }
  };

  const cancelForm = async () => {
    if (!form || !session) return;
    setFormBusy(true);
    setFormError(null);
    try {
      await api.cancelForm(session.id, form.id, "Cancelled in nit-gui");
      setValue("");
      onFormDone();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not cancel the form.";
      setFormError(message);
      onError(message);
    } finally {
      setFormBusy(false);
    }
  };

  const query = answerText.startsWith("/") && !answerText.includes("\n") ? answerText.slice(1) : null;
  const matches =
    query !== null && !query.includes(" ")
      ? commands.filter((item) => item.id.startsWith(query.toLowerCase()))
      : [];
  const paletteOpen = !question && matches.length > 0 && !commandDismissed && !recording;
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

  return (
    <div className="shrink-0">
      <div className="mx-auto w-full max-w-3xl px-4 pt-2 pb-3">
        <div
          className={cn(
            "border-border bg-card relative rounded-xl border shadow-sm",
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

          {form && question && (
            <div className="border-border border-b">
              <button
                type="button"
                aria-expanded={formOpen}
                onClick={() => setFormOpen((current) => !current)}
                className="flex w-full items-start gap-2 px-3 pt-2.5 pb-2 text-left"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold">{form.title}</span>
                  <span className="text-muted-foreground block truncate text-[10px]">
                    {formOpen
                      ? "The agent is waiting for your answer."
                      : (option?.label ?? (answerText.trim() ? "Custom answer" : "Your answer"))}
                  </span>
                </span>
                <ChevronDown
                  className={cn(
                    "text-muted-foreground mt-0.5 size-4 shrink-0 transition-transform",
                    !formOpen && "-rotate-90",
                  )}
                />
              </button>

              {formOpen && (
                <div className="px-3 pb-2.5">
                  <div className="text-[12px] font-medium">
                    {question.title ?? question.key}
                    {question.required && <span className="text-destructive"> *</span>}
                  </div>
                  {question.description && (
                    <p className="text-muted-foreground mt-0.5 text-[11px] leading-4">
                      {question.description}
                    </p>
                  )}
                  {(question.options?.length ?? 0) > 0 && (
                    <div className="scrollbar-thin mt-1.5 max-h-44 space-y-0.5 overflow-y-auto">
                      {question.options?.map((item) => (
                        <label
                          key={item.value}
                          className={cn(
                            "hover:bg-accent/50 flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-[12px]",
                            value === item.value && "bg-accent/50",
                          )}
                        >
                          <input
                            type="radio"
                            name={`${form.id}-${question.key}`}
                            checked={value === item.value}
                            onChange={() => setValue(item.value)}
                            className="accent-primary mt-0.5 size-3.5"
                          />
                          <span className="min-w-0">
                            <span className="block">{item.label}</span>
                            {item.description && (
                              <span className="text-muted-foreground block text-[10px]">
                                {item.description}
                              </span>
                            )}
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {formError && (
                <p className="text-destructive px-3 pb-2 text-[11px]">{formError}</p>
              )}
            </div>
          )}

          {!question && attachments.length > 0 && (
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

          {spellcheck && spellOpen && issues.length > 0 && (
            <div className="border-border border-b px-3 py-2">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium">Spelling · {issues.length}</span>
                <button
                  type="button"
                  onClick={() => setSpellOpen(false)}
                  aria-label="Close spelling"
                  className="text-muted-foreground hover:text-foreground rounded p-0.5"
                >
                  <X className="size-3.5" />
                </button>
              </div>
              <ul className="scrollbar-thin max-h-32 space-y-1 overflow-y-auto">
                {issues.map((issue) => (
                  <li
                    key={issueKey(issue)}
                    className="flex flex-wrap items-baseline gap-1.5 text-[11px]"
                  >
                    <span
                      className="text-destructive max-w-44 truncate font-mono"
                      title={issue.word}
                    >
                      {issue.word}
                    </span>
                    {issue.suggestions.length === 0 ? (
                      <span className="text-muted-foreground">no suggestions</span>
                    ) : (
                      issue.suggestions.map((suggestion) => (
                        <button
                          key={suggestion}
                          type="button"
                          onClick={() => applySuggestion(issue, suggestion)}
                          aria-label={`Replace ${issue.word} with ${suggestion}`}
                          className="bg-muted hover:bg-accent rounded px-1.5 py-0.5 font-mono"
                        >
                          {suggestion}
                        </button>
                      ))
                    )}
                    <button
                      type="button"
                      onClick={() => ignoreWord(issue.word)}
                      className="text-muted-foreground hover:text-foreground underline"
                    >
                      ignore
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {customAnswer && (
            <div className="relative">
              <Textarea
                ref={ref}
                rows={1}
                value={answerText}
                disabled={disabled || !workspace || formBusy}
                aria-label={question ? "Answer" : "Message"}
                spellCheck={false}
                placeholder={
                  question
                    ? (question.placeholder ??
                      ((question.options?.length ?? 0) > 0
                        ? "Or type your own answer…"
                        : "Type your answer…"))
                    : !workspace
                      ? "Choose a workspace to start"
                      : session
                        ? "Ask anything…  / for commands"
                        : "New chat in this workspace…"
                }
                className={cn(
                  COMPOSER_TEXT,
                  "block scrollbar-none max-h-[200px] min-h-[44px] overflow-y-auto",
                )}
                onChange={(event) => setValue(event.target.value)}
                onScroll={syncScroll}
                onPaste={(event) => {
                  const files = Array.from(event.clipboardData.files);
                  if (!question && files.length > 0) {
                    event.preventDefault();
                    addFiles(files);
                  }
                }}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === ".") {
                    event.preventDefault();
                    if (issues.length > 0) setSpellOpen((current) => !current);
                    return;
                  }
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
                  if (event.key === "Escape" && spellOpen) {
                    event.preventDefault();
                    event.stopPropagation();
                    setSpellOpen(false);
                    return;
                  }
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    if (question) void answerForm();
                    else void submit();
                  }
                }}
              />
              <ComposerHighlights ref={highlightRef} value={answerText} issues={issues} />
            </div>
          )}
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
            {!question && (
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
            )}
            {spellcheck && issues.length > 0 && (
              <Button
                variant={spellOpen ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setSpellOpen((current) => !current)}
                title={`Spelling · ${issues.length}`}
                aria-label={`Spelling, ${issues.length} issue${issues.length === 1 ? "" : "s"}`}
              >
                <SpellCheck />
                <span className="font-mono text-[11px]">{issues.length}</span>
              </Button>
            )}
            {!question && (
              <Button
                variant={recording ? "destructive" : "ghost"}
                size={recording || finishing ? "sm" : "icon-sm"}
                onClick={toggleDictation}
                disabled={disabled || !workspace || finishing || submitting}
                title={recording ? "Stop dictation" : "Dictate"}
                aria-label={recording ? "Stop dictation" : "Dictate"}
              >
                {finishing ? (
                  <Loader2 className="animate-spin" />
                ) : recording ? (
                  <Square className="fill-current" />
                ) : (
                  <Mic />
                )}
                {recording && (
                  <span className="font-mono text-[11px]">
                    0:{String(elapsed).padStart(2, "0")}
                    {pending > 0 ? ` · ${pending}` : ""}
                  </span>
                )}
                {finishing && <span className="text-[11px]">Transcribing…</span>}
              </Button>
            )}
            <span
              aria-live="polite"
              className={cn(
                "hidden text-[11px] sm:inline",
                recording ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {question
                ? customAnswer
                  ? "Enter to answer · Shift+Enter for a new line"
                  : "Pick an option above"
                : finishing
                  ? "Finishing transcription…"
                  : recording
                    ? pending > 0
                      ? `Recording · ${pending} segment${pending === 1 ? "" : "s"} queued`
                      : dictationMode === "fast"
                        ? "Recording · text appears as you pause"
                        : "Recording · transcribing when you stop"
                    : "Enter to send · Shift+Enter for a new line · / commands"}
            </span>
            <div className="ml-auto flex items-center gap-1">
              {running && !question && (
                <Button variant="secondary" size="sm" onClick={onStop} aria-label="Stop">
                  <Square className="fill-current" />
                  Stop
                </Button>
              )}
              {question ? (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void cancelForm()}
                    disabled={formBusy}
                  >
                    <X />
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => void answerForm()}
                    disabled={formBusy || (question.required && !value.trim())}
                  >
                    {formBusy ? <Loader2 className="animate-spin" /> : <Check />}
                    Answer
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  onClick={() => void submit()}
                  disabled={
                    !workspace || disabled || !value.trim() || submitting || uploading || finishing
                  }
                  aria-label={running ? "Queue message" : "Send"}
                >
                  {submitting ? <Loader2 className="animate-spin" /> : <ArrowUp />}
                  {running ? "Queue" : "Send"}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
