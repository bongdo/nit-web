import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowUp,
  Check,
  ChevronDown,
  Loader2,
  Paperclip,
  Square,
  X,
} from "lucide-react";
import type { FormInfo, Model, Session } from "../lib/types";
import { api } from "../lib/api";
import { attachmentWarning } from "../lib/attachments";
import { loadDraftFiles, saveDraftFiles } from "../lib/draft-files";
import { loadDraftState, saveDraftState, type DraftState } from "../lib/drafts";
import { questionAnswer, questionFields } from "../lib/forms";
import { formatBytes, quoteText } from "../lib/format";
import { shouldCaptureKey, shortcutKeys } from "../lib/keys";
import {
  addsOnlyPunctuation,
  applyIssue,
  hidePending,
  issueAtCaret,
  issueKey,
  maskedAt,
  safeAutoFix,
  type SpellIssue,
} from "../lib/spell";
import { useSpellcheck } from "../hooks/useSpellcheck";
import { useCompletion } from "../hooks/useCompletion";
import { checkSpelling } from "../lib/spell-client";
import { cn } from "../lib/utils";
import { FileTypeIcon } from "./Attachment";
import { ImageCrop } from "./ImageCrop";
import { CommandPalette } from "./CommandPalette";
import { COMPOSER_TEXT, ComposerHighlights, type ComposerHighlightsHandle, type HintRect } from "./ComposerHighlights";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";

export type Attachment = {
  id: string;
  name: string;
  size: number;
  mime: string;
  path?: string;
  file?: File;
  preview?: string;
  error?: string;
};

export type ComposerCommand = {
  id: string;
  label: string;
  description: string;
};

type AutoFix = {
  original: string;
  replacement: string;
  start: number;
  at: number;
  ignore: boolean;
};

const MAX_UPLOAD = 20 << 20;
const HINT_HEIGHT = 26;
const ASK_WORD =
  /^\s*(?:(ask)\s*[:：,，—–\-?？!！.。]|(аск|вопрос)(?=\s|$|[:：,，—–\-?？!！.。]))/i;

function attachmentId() {
  return `att-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function restoredAttachment(file: File): Attachment {
  return {
    id: attachmentId(),
    name: file.name || "file",
    size: file.size,
    mime: file.type,
    preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined,
    file,
  };
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

export const Composer = memo(function Composer({
  session,
  workspace,
  model,
  disabled,
  running,
  focusKey,
  typingBlocked,
  drawerOpen,
  draftKey,
  instance,
  draft,
  insert,
  commands,
  spellcheck,
  autofix,
  form,
  onSend,
  onStop,
  onCommand,
  onError,
  onFormDone,
  onDraftApplied,
  onInsertApplied,
}: {
  session: Session | null;
  workspace: string | null;
  model?: Model | null;
  disabled?: boolean;
  running?: boolean;
  focusKey?: string | null;
  typingBlocked?: boolean;
  drawerOpen?: boolean;
  draftKey: string;
  instance: string;
  draft?: { text: string; id: number } | null;
  insert?: { text: string; id: number } | null;
  commands: ComposerCommand[];
  spellcheck: boolean;
  autofix: boolean;
  form?: FormInfo | null;
  onSend: (text: string, attachments: Attachment[], delivery?: "queue" | "steer") => Promise<void>;
  onStop: () => void;
  onCommand: (id: string) => void;
  onError: (message: string) => void;
  onFormDone: () => void;
  onDraftApplied?: () => void;
  onInsertApplied?: () => void;
}) {
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const customSpell = spellcheck && !coarse;
  const [value, setText] = useState(() => loadDraftState(draftKey).text);
  const valueRef = useRef(value);
  valueRef.current = value;
  const [hydrated, setHydrated] = useState(false);
  const hydratedRef = useRef(false);
  const editedRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [shift, setShift] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const attachmentsRef = useRef<Attachment[]>([]);
  attachmentsRef.current = attachments;
  const [filesReady, setFilesReady] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const [commandIndex, setCommandIndex] = useState(0);
  const [commandDismissed, setCommandDismissed] = useState(false);
  const [ignored, setIgnored] = useState<string[]>(loadIgnoredWords);
  const [undoFix, setUndoFix] = useState<AutoFix | null>(null);
  const [caret, setCaret] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [hintRect, setHintRect] = useState<HintRect | null>(null);
  const [formOpen, setFormOpen] = useState(true);
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formStep, setFormStep] = useState(0);
  const formAnswers = useRef<Record<string, string>>({});
  const [removing, setRemoving] = useState<string[]>([]);
  const [cropId, setCropId] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<ComposerHighlightsHandle>(null);
  const syncFrame = useRef(0);
  const syncUntil = useRef(0);
  const autoCorrectPending = useRef(false);
  const grammarFixes = useRef(0);
  const lastTypedAt = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const draftBeforeForm = useRef("");
  const activeForm = useRef<string | null>(null);
  const appliedDraft = useRef<number | null>(null);
  const appliedInsert = useRef<number | null>(null);
  const addedDelay = useRef(new Map<string, number>());
  const removeTimers = useRef(new Set<number>());
  const questions = form ? (questionFields(form) ?? []) : [];
  const step = Math.min(formStep, Math.max(0, questions.length - 1));
  const question = questions[step] ?? null;
  const lastQuestion = step >= questions.length - 1;
  const questionRef = useRef(question);
  questionRef.current = question;
  const option = question?.options?.find((item) => item.value === value) ?? null;
  const answerText = option ? "" : value;
  const customAnswer = !question || (question.options?.length ?? 0) === 0 || question.custom !== false;
  const askWord = !question ? ASK_WORD.exec(answerText) : null;
  const askText = askWord ? (askWord[1] ?? askWord[2]) : null;
  const askStart = askWord && askText ? askWord[0].indexOf(askText) : -1;
  const askRange =
    askText && askStart >= 0 ? { start: askStart, end: askStart + askText.length } : null;
  const updateValue = (next: string | ((current: string) => string)) => {
    const resolved = typeof next === "function" ? next(valueRef.current) : next;
    valueRef.current = resolved;
    setText(resolved);
    if (!question) {
      editedRef.current = true;
      hydratedRef.current = true;
      setHydrated(true);
      saveDraftState(draftKey, resolved, Date.now());
      if (!resolved) void api.setDraft(draftKey, "", instance).catch(() => {});
    }
  };

  useEffect(() => {
    let cancelled = false;
    const local: DraftState = loadDraftState(draftKey);
    api.draft(draftKey, instance)
      .then((remote: { text: string; updatedAt: number; cleared?: boolean }) => {
        if (cancelled) return;
        if (!editedRef.current) {
          if (remote.updatedAt >= local.updatedAt && remote.cleared) {
            valueRef.current = "";
            setText("");
            saveDraftState(draftKey, "", remote.updatedAt);
          } else if (remote.updatedAt >= local.updatedAt && remote.text) {
            valueRef.current = remote.text;
            setText(remote.text);
            saveDraftState(draftKey, remote.text, remote.updatedAt);
          } else if (local.text && local.updatedAt > remote.updatedAt) {
            void api.setDraft(draftKey, local.text, instance).catch(() => {});
          }
        }
        hydratedRef.current = true;
        setHydrated(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [draftKey, instance]);

  useEffect(() => {
    let cancelled = false;
    loadDraftFiles(draftKey)
      .then((files) => {
        if (cancelled || files.length === 0) return;
        setAttachments((current) =>
          current.length > 0 ? current : files.map(restoredAttachment),
        );
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setFilesReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [draftKey]);

  // shortcut: an abandoned draft that is never sent or cleared keeps its files in IndexedDB, prune them when the app gains draft expiry
  useEffect(() => {
    if (!filesReady) return;
    const files = attachments.flatMap((item) => (item.file ? [item.file] : []));
    void saveDraftFiles(draftKey, files).catch(() => {});
  }, [attachments, draftKey, filesReady]);

  useEffect(
    () => () => {
      for (const item of attachmentsRef.current) {
        if (item.preview) URL.revokeObjectURL(item.preview);
      }
    },
    [],
  );

  useEffect(() => {
    if (!hydrated || question) return;
    const timer = window.setTimeout(() => {
      const text = valueRef.current;
      saveDraftState(draftKey, text, Date.now());
      void api.setDraft(draftKey, text, instance).catch(() => {});
    }, 700);
    return () => window.clearTimeout(timer);
  }, [value, hydrated, draftKey, instance, question]);

  useEffect(
    () => () => {
      if (questionRef.current || !hydratedRef.current) return;
      const text = valueRef.current;
      saveDraftState(draftKey, text, Date.now());
      void api.setDraft(draftKey, text, instance).catch(() => {});
    },
    [draftKey, instance],
  );

  const { issues: detected } = useSpellcheck(
    question && !customAnswer ? "" : answerText,
    customSpell,
    ignored,
  );
  const issues = hidePending(
    askRange
      ? detected.filter((issue) => issue.end <= askRange.start || issue.start >= askRange.end)
      : detected,
    answerText,
    caret,
  );
  const ghost = useCompletion(answerText, caret, customSpell && !disabled, ignored);

  useEffect(() => {
    if (!focusKey) return;
    if (coarse) return;
    ref.current?.focus();
  }, [focusKey, coarse]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!customAnswer || disabled || !workspace || formBusy) return;
      const target = event.target instanceof Element ? event.target : null;
      const menu = document.querySelector("[role='menu']");
      const blocked = Boolean(
        typingBlocked ||
          (drawerOpen && window.innerWidth < 768) ||
          (menu && menu.getClientRects().length > 0),
      );
      if (!shouldCaptureKey(event, target, blocked)) return;
      if (event.key === " ") autoCorrectPending.current = true;
      ref.current?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [customAnswer, disabled, drawerOpen, formBusy, typingBlocked, workspace]);

  useEffect(() => {
    let timer = 0;
    const clear = () => {
      clearTimeout(timer);
      timer = 0;
      setShift(false);
    };
    const down = (event: KeyboardEvent) => {
      if (event.key !== "Shift") {
        if (timer) clear();
        return;
      }
      if (!timer) timer = window.setTimeout(() => setShift(true), 1000);
    };
    const up = (event: KeyboardEvent) => {
      if (event.key === "Shift") clear();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", clear);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", clear);
    };
  }, []);

  useEffect(() => {
    if (form && questions.length > 0) {
      if (activeForm.current === form.id) return;
      activeForm.current = form.id;
      const first = questions[0];
      formAnswers.current = {};
      setFormStep(0);
      updateValue((current) => {
        draftBeforeForm.current = current;
        return typeof first.default === "string" ? first.default : "";
      });
      setFormOpen(true);
      setFormError(null);
      return;
    }
    if (!activeForm.current) return;
    activeForm.current = null;
    formAnswers.current = {};
    setFormStep(0);
    updateValue(draftBeforeForm.current);
    setFormError(null);
  }, [form, questions.length]);

  useEffect(
    () => () => {
      for (const timer of removeTimers.current) window.clearTimeout(timer);
    },
    [],
  );

  useEffect(() => {
    if (!draft || appliedDraft.current === draft.id) return;
    appliedDraft.current = draft.id;
    updateValue(draft.text);
    onDraftApplied?.();
    requestAnimationFrame(() => {
      const area = ref.current;
      if (!area) return;
      area.focus();
      area.setSelectionRange(area.value.length, area.value.length);
    });
  }, [draft]);

  useEffect(() => {
    if (!insert || appliedInsert.current === insert.id) return;
    appliedInsert.current = insert.id;
    const quoted = quoteText(insert.text);
    updateValue((current) =>
      current.trim() ? `${current.replace(/\s+$/, "")}\n\n${quoted}\n\n` : `${quoted}\n\n`,
    );
    onInsertApplied?.();
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

  useLayoutEffect(() => {
    const area = ref.current;
    if (!area) return;
    highlightRef.current?.sync(area.scrollTop, area.scrollLeft);
  }, [value]);

  const syncScroll = () => {
    const area = ref.current;
    if (!area) return;
    highlightRef.current?.sync(area.scrollTop, area.scrollLeft);
    setHintRect(null);
  };

  const startSync = () => {
    syncUntil.current = Date.now() + 700;
    if (syncFrame.current) return;
    const tick = () => {
      const area = ref.current;
      if (area) highlightRef.current?.sync(area.scrollTop, area.scrollLeft);
      syncFrame.current = Date.now() < syncUntil.current ? requestAnimationFrame(tick) : 0;
    };
    syncFrame.current = requestAnimationFrame(tick);
  };

  useEffect(() => () => cancelAnimationFrame(syncFrame.current), []);

  const updateCaret = () => {
    const area = ref.current;
    if (!area || area.selectionStart !== area.selectionEnd) {
      setCaret(null);
      return;
    }
    const next = area.selectionStart;
    const nextIssue = issueAtCaret(issues, next);
    if (!nextIssue || issueKey(nextIssue) !== dismissed) setDismissed(null);
    setCaret(next);
  };

  const onHintRect = useCallback((rect: HintRect | null) => {
    setHintRect((current) => {
      if (!rect) return current === null ? current : null;
      if (
        current &&
        current.left === rect.left &&
        current.top === rect.top &&
        current.width === rect.width &&
        current.height === rect.height
      ) {
        return current;
      }
      return rect;
    });
  }, []);

  const activeIssue = issueAtCaret(issues, caret, answerText);
  const visibleIssue = activeIssue && issueKey(activeIssue) !== dismissed ? activeIssue : null;

  useEffect(() => {
    if (!customSpell || question || disabled || formBusy || grammarFixes.current > 0) return;
    if (lastTypedAt.current === 0) return;
    if (answerText.startsWith("/") && !answerText.includes("\n")) return;
    const area = ref.current;
    if (!area || document.activeElement !== area) return;
    const caretNow = area.selectionStart;
    if (caretNow !== area.selectionEnd) return;
    const issue = issues.find(
      (item) =>
        item.source === "grammar" &&
        caretNow >= item.end &&
        item.suggestions.length === 1 &&
        addsOnlyPunctuation(answerText.slice(item.start, item.end), item.suggestions[0]),
    );
    if (!issue) return;
    const replacement = issue.suggestions[0];
    const position = caretNow + replacement.length - (issue.end - issue.start);
    grammarFixes.current += 1;
    updateValue(applyIssue(answerText, issue, replacement));
    setCaret(position);
    setUndoFix({
      original: answerText.slice(issue.start, issue.end),
      replacement,
      start: issue.start,
      at: Date.now(),
      ignore: false,
    });
    requestAnimationFrame(() => {
      const current = ref.current;
      if (!current) return;
      current.focus();
      current.setSelectionRange(position, position);
    });
  }, [issues, answerText, customSpell, question, disabled, formBusy]);

  useEffect(() => {
    const hide = () => setHintRect(null);
    window.addEventListener("resize", hide);
    return () => window.removeEventListener("resize", hide);
  }, []);

  useEffect(() => {
    if (!undoFix) return;
    const timer = window.setTimeout(() => setUndoFix(null), 10_000);
    return () => window.clearTimeout(timer);
  }, [undoFix]);

  useEffect(() => {
    setCommandIndex(0);
    setCommandDismissed(false);
  }, [value]);

  const applySuggestion = (issue: SpellIssue, replacement: string) => {
    const position = issue.start + replacement.length;
    updateValue(applyIssue(answerText, issue, replacement));
    setCaret(position);
    setDismissed(null);
    setHintRect(null);
    requestAnimationFrame(() => {
      const area = ref.current;
      if (!area) return;
      area.focus();
      area.setSelectionRange(position, position);
    });
  };

  const ignoreWord = (word: string) => {
    const clean = word.trim().toLowerCase();
    if (!clean) return;
    setHintRect(null);
    setDismissed(null);
    setIgnored((current) => {
      if (current.includes(clean)) return current;
      const next = [...current, clean];
      localStorage.setItem("nit-gui.spell-ignore", JSON.stringify(next));
      return next;
    });
  };

  const autoFixWord = async (start: number, end: number, word: string) => {
    if (!autofix || !customSpell) return;
    const started = Date.now();
    const found = await checkSpelling(word, ignored);
    if (Date.now() - started > 4000 || !autofix || !customSpell) return;
    const issue = found.find((item) => item.start === 0 && item.end === word.length);
    const fix = issue ? safeAutoFix(word, issue.suggestions) : null;
    if (!fix) return;
    const area = ref.current;
    if (!area || area.value.slice(start, end) !== word) return;
    const caretNow = area.selectionStart;
    const next = area.value.slice(0, start) + fix + area.value.slice(end);
    const shift = fix.length - word.length;
    const nextCaret = caretNow >= end ? caretNow + shift : caretNow;
    updateValue(next);
    setCaret(nextCaret);
    setDismissed(null);
    setHintRect(null);
    setUndoFix({ original: word, replacement: fix, start, at: Date.now(), ignore: true });
    requestAnimationFrame(() => {
      const current = ref.current;
      if (!current) return;
      current.focus();
      current.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const revertAutoFix = () => {
    const fix = undoFix;
    const area = ref.current;
    if (!fix || !area) return;
    const end = fix.start + fix.replacement.length;
    if (area.value.slice(fix.start, end) !== fix.replacement) {
      setUndoFix(null);
      return;
    }
    const next = area.value.slice(0, fix.start) + fix.original + area.value.slice(end);
    const shift = fix.original.length - fix.replacement.length;
    const caretNow = area.selectionStart;
    const nextCaret = caretNow >= end ? caretNow + shift : caretNow;
    updateValue(next);
    setCaret(nextCaret);
    if (fix.ignore) ignoreWord(fix.original);
    setUndoFix(null);
    requestAnimationFrame(() => {
      const current = ref.current;
      if (!current) return;
      current.focus();
      current.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const learnSentWords = (words: string[]) => {
    let counts: Record<string, number> = {};
    try {
      const stored = JSON.parse(localStorage.getItem("nit-gui.spell-seen") ?? "{}");
      if (stored && typeof stored === "object" && !Array.isArray(stored)) {
        counts = stored as Record<string, number>;
      }
    } catch {
      counts = {};
    }
    const learned: string[] = [];
    for (const word of words) {
      const count = (counts[word] ?? 0) + 1;
      counts[word] = count;
      if (count >= 3) {
        learned.push(word);
        delete counts[word];
      }
    }
    localStorage.setItem("nit-gui.spell-seen", JSON.stringify(counts));
    if (learned.length === 0) return;
    setIgnored((current) => {
      const next = Array.from(new Set([...current, ...learned]));
      localStorage.setItem("nit-gui.spell-ignore", JSON.stringify(next));
      return next;
    });
  };

  const addFiles = (files: File[]) => {
    if (!workspace) {
      onError("Choose a workspace before attaching files.");
      return;
    }
    let offset = 0;
    for (const file of files) {
      if (file.size > MAX_UPLOAD) {
        onError(`${file.name} is larger than ${formatBytes(MAX_UPLOAD)}.`);
        continue;
      }
      const id = attachmentId();
      const preview = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined;
      const warning = attachmentWarning({ name: file.name, mime: file.type }, model);
      addedDelay.current.set(id, offset * 35);
      offset += 1;
      setAttachments((current) => [
        ...current,
        { id, name: file.name || "file", size: file.size, mime: file.type, preview, file },
      ]);
      if (warning) onError(warning);
    }
  };

  const removeAttachment = (id: string) => {
    if (removing.includes(id)) return;
    setRemoving((current) => [...current, id]);
    const timer = window.setTimeout(() => {
      removeTimers.current.delete(timer);
      setAttachments((current) => {
        const found = current.find((item) => item.id === id);
        if (found?.preview) URL.revokeObjectURL(found.preview);
        return current.filter((item) => item.id !== id);
      });
      setRemoving((current) => current.filter((item) => item !== id));
      addedDelay.current.delete(id);
    }, 160);
    removeTimers.current.add(timer);
  };

  const applyCrop = (id: string, file: File) => {
    setCropId(null);
    if (file.size > MAX_UPLOAD) {
      onError(`${file.name} is larger than ${formatBytes(MAX_UPLOAD)}.`);
      return;
    }
    const previous = attachmentsRef.current.find((item) => item.id === id)?.preview;
    if (previous) URL.revokeObjectURL(previous);
    const preview = URL.createObjectURL(file);
    setAttachments((current) =>
      current.map((item) =>
        item.id === id
          ? {
              ...item,
              name: file.name,
              size: file.size,
              mime: file.type,
              file,
              preview,
              error: undefined,
            }
          : item,
      ),
    );
  };

  const visibleAttachments = attachments.filter((item) => !removing.includes(item.id));
  const cropItem = attachments.find((item) => item.id === cropId);
  const readyFiles = visibleAttachments.filter((item) => !item.error);
  const queue = Boolean(running) && shift;

  const submit = async () => {
    const text = value.trim();
    if ((!text && readyFiles.length === 0) || !workspace || disabled || submitting) return;
    const dir = workspace;
    setSubmitting(true);
    try {
      const uploaded: Attachment[] = [];
      for (const item of readyFiles) {
        if (item.path || !item.file) {
          uploaded.push(item);
          continue;
        }
        try {
          const result = await api.upload(item.file, dir);
          uploaded.push({ ...item, path: result.path, name: result.name });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Upload failed";
          setAttachments((current) =>
            current.map((entry) => (entry.id === item.id ? { ...entry, error: message } : entry)),
          );
          onError(message);
          return;
        }
      }
      setAttachments(uploaded);
      await onSend(text, uploaded, running ? (queue ? "queue" : "steer") : undefined);
      const misspelled = issues
        .filter((issue) => issue.source !== "grammar")
        .map((issue) => issue.word.toLowerCase());
      if (misspelled.length > 0) learnSentWords(misspelled);
      updateValue("");
      void saveDraftFiles(draftKey, []).catch(() => {});
      for (const item of attachments) {
        if (item.preview) URL.revokeObjectURL(item.preview);
      }
      setRemoving([]);
      addedDelay.current.clear();
      setAttachments([]);
    } catch {
      return;
    } finally {
      setSubmitting(false);
    }
  };

  const saveAnswer = () => {
    if (question) formAnswers.current[question.key] = value.trim();
  };

  const nextQuestion = () => {
    if (!question) return;
    const text = value.trim();
    if (question.required && !text) {
      setFormError(`${question.title ?? question.key} is required.`);
      return;
    }
    saveAnswer();
    const target = questions[step + 1];
    setFormStep(step + 1);
    updateValue(formAnswers.current[target.key] ?? (typeof target.default === "string" ? target.default : ""));
    setFormError(null);
  };

  const previousQuestion = () => {
    if (!question || step === 0) return;
    saveAnswer();
    const target = questions[step - 1];
    setFormStep(step - 1);
    updateValue(formAnswers.current[target.key] ?? (typeof target.default === "string" ? target.default : ""));
    setFormError(null);
  };

  const answerForm = async () => {
    if (!form || !question || !session) return;
    const text = value.trim();
    if (question.required && !text) {
      setFormError(`${question.title ?? question.key} is required.`);
      return;
    }
    saveAnswer();
    const answer = questionAnswer(questions, formAnswers.current);
    setFormBusy(true);
    setFormError(null);
    try {
      await api.replyForm(session.id, form.id, answer);
      formAnswers.current = {};
      setFormStep(0);
      updateValue("");
      onFormDone();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not submit the answer.";
      setFormError(message);
      onError(message);
    } finally {
      setFormBusy(false);
    }
  };

  const advanceForm = () => {
    if (lastQuestion) void answerForm();
    else nextQuestion();
  };

  const cancelForm = async () => {
    if (!form || !session) return;
    setFormBusy(true);
    setFormError(null);
    try {
      await api.cancelForm(session.id, form.id, "Cancelled in nit-gui");
      formAnswers.current = {};
      setFormStep(0);
      updateValue("");
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
  const paletteOpen = !question && matches.length > 0 && !commandDismissed;
  const selectedCommand = matches[Math.min(commandIndex, Math.max(0, matches.length - 1))];

  const runCommand = (id: string) => {
    if (id === "clear") {
      updateValue("");
      return;
    }
    updateValue("");
    setCommandDismissed(true);
    onCommand(id);
  };

  const hintTop = (() => {
    if (!hintRect) return 0;
    const height = ref.current?.clientHeight ?? 0;
    const below = hintRect.top + hintRect.height + 2;
    const above = hintRect.top - HINT_HEIGHT - 2;
    if (below + HINT_HEIGHT <= height) return below;
    if (above >= 0) return above;
    return height + 4;
  })();

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
            if (!question && event.dataTransfer.files.length > 0) {
              addFiles(Array.from(event.dataTransfer.files));
            }
          }}
        >
          <CommandPalette
            open={paletteOpen}
            items={matches}
            selected={commandIndex}
            onSelect={runCommand}
            onHighlight={setCommandIndex}
            onDismiss={() => setCommandDismissed(true)}
          />

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
                      ? questions.length > 1
                        ? `Question ${step + 1} of ${questions.length} · The agent is waiting for your answer.`
                        : "The agent is waiting for your answer."
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
                  {questions.length > 1 && (
                    <div className="text-muted-foreground text-[10px] font-medium">
                      {step + 1}/{questions.length}
                    </div>
                  )}
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
                          key={`${question.key}-${item.value}`}
                          className={cn(
                            "form-sheen-option hover:bg-accent/50 flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-[12px]",
                            value === item.value && "bg-accent/50",
                          )}
                        >
                          <input
                            type="radio"
                            name={`${form.id}-${question.key}`}
                            checked={value === item.value}
                            onChange={() => updateValue(item.value)}
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
              {attachments.map((item) => {
                const warning = attachmentWarning(item, model);
                return (
                  <span
                    key={item.id}
                    className={cn(
                      "attach-sheen-chip border-border bg-muted/40 flex max-w-full items-center gap-1.5 rounded-md border px-1.5 py-1 text-[11px]",
                      item.error && "border-destructive/50",
                      warning && "border-amber-500/60",
                      removing.includes(item.id) && "attach-sheen-leave",
                    )}
                    title={item.error ?? warning ?? item.name}
                    style={{ animationDelay: `${addedDelay.current.get(item.id) ?? 0}ms` }}
                  >
                    {item.preview ? (
                      <button
                        type="button"
                        onClick={() => setCropId(item.id)}
                        aria-label={`Open and crop ${item.name}`}
                        title="Open and crop"
                        className="hover:ring-ring shrink-0 rounded ring-offset-1 hover:ring-1"
                      >
                        <img src={item.preview} alt="" className="size-5 rounded object-cover" />
                      </button>
                    ) : (
                      <FileTypeIcon
                        name={item.name}
                        mime={item.mime}
                        className="text-muted-foreground"
                      />
                    )}
                    <span className="max-w-40 truncate">{item.name}</span>
                    <span className="text-muted-foreground">{formatBytes(item.size)}</span>
                    {warning && <AlertTriangle className="size-3 text-amber-500" />}
                    {submitting && !item.path && <Loader2 className="size-3 animate-spin" />}
                    <button
                      type="button"
                      onClick={() => removeAttachment(item.id)}
                      disabled={removing.includes(item.id)}
                      aria-label={`Remove ${item.name}`}
                      className="hover:bg-accent rounded p-0.5"
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                );
              })}
            </div>
          )}

          {customAnswer && (
            <div className="relative">
              <Textarea
                ref={ref}
                rows={1}
                value={answerText}
                disabled={!workspace || formBusy}
                aria-label={question ? "Answer" : "Message"}
                spellCheck={coarse && spellcheck}
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
                onChange={(event) => {
                  const next = event.target.value;
                  const pending = autoCorrectPending.current;
                  autoCorrectPending.current = false;
                  grammarFixes.current = 0;
                  lastTypedAt.current = Date.now();
                  updateValue(next);
                  const caretNow = event.target.selectionStart;
                  setCaret(caretNow === event.target.selectionEnd ? caretNow : null);
                  setDismissed(null);
                  if (!pending || !autofix || !customSpell) return;
                  if (caretNow !== next.length || !/[ \t\n.,;:!?]$/u.test(next)) return;
                  if (next.startsWith("/") && !next.includes("\n")) return;
                  const end = next.length - 1;
                  const match = /(\p{L}[\p{L}\p{M}]*(?:['’\-]\p{L}[\p{L}\p{M}]*)*)$/u.exec(
                    next.slice(0, end),
                  );
                  if (!match) return;
                  const word = match[1];
                  const start = end - word.length;
                  if (maskedAt(next, start)) return;
                  if (ignored.includes(word.toLowerCase())) return;
                  void autoFixWord(start, end, word);
                }}
                onScroll={syncScroll}
                onWheel={startSync}
                onTouchMove={startSync}
                onSelect={updateCaret}
                onClick={() => {
                  setDismissed(null);
                  updateCaret();
                }}
                onKeyUp={updateCaret}
                onPaste={(event) => {
                  const files = Array.from(event.clipboardData.files);
                  if (!question && files.length > 0) {
                    event.preventDefault();
                    addFiles(files);
                  }
                }}
                onKeyDown={(event) => {
                  if (
                    (event.metaKey || event.ctrlKey) &&
                    shortcutKeys(event).includes("z") &&
                    !event.shiftKey &&
                    undoFix
                  ) {
                    const area = ref.current;
                    const end = undoFix.start + undoFix.replacement.length;
                    if (
                      area &&
                      area.selectionStart >= end &&
                      area.value.slice(undoFix.start, end) === undoFix.replacement
                    ) {
                      event.preventDefault();
                      event.stopPropagation();
                      revertAutoFix();
                      return;
                    }
                  }
                  if (event.key === "Backspace" && undoFix) {
                    const area = ref.current;
                    const end = undoFix.start + undoFix.replacement.length;
                    if (
                      area &&
                      area.selectionStart === end &&
                      area.selectionEnd === end &&
                      area.value.slice(undoFix.start, end) === undoFix.replacement
                    ) {
                      event.preventDefault();
                      event.stopPropagation();
                      revertAutoFix();
                      return;
                    }
                  }
                  if (
                    event.key === "Backspace" &&
                    askRange &&
                    !event.metaKey &&
                    !event.ctrlKey &&
                    !event.altKey
                  ) {
                    const area = ref.current;
                    if (
                      area &&
                      area.selectionStart === area.selectionEnd &&
                      area.selectionStart > askRange.start &&
                      area.selectionStart <= askRange.end
                    ) {
                      event.preventDefault();
                      event.stopPropagation();
                      const next =
                        area.value.slice(0, askRange.start) + area.value.slice(askRange.end);
                      updateValue(next);
                      setCaret(askRange.start);
                      requestAnimationFrame(() =>
                        area.setSelectionRange(askRange.start, askRange.start),
                      );
                      return;
                    }
                  }
                  if (
                    (/^[ .,;:!?]$/u.test(event.key) || (event.key === "Enter" && event.shiftKey)) &&
                    !event.nativeEvent.isComposing &&
                    !event.metaKey &&
                    !event.ctrlKey &&
                    !event.altKey
                  ) {
                    autoCorrectPending.current = true;
                  }
                  const plainTab =
                    event.key === "Tab" && !event.ctrlKey && !event.metaKey && !event.altKey;
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
                    if (plainTab && selectedCommand) {
                      event.preventDefault();
                      updateValue(`/${selectedCommand.id}`);
                      return;
                    }
                    if (event.key === "Enter" && !event.shiftKey && selectedCommand && !coarse) {
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
                  const firstSuggestion = visibleIssue?.suggestions[0];
                  if (plainTab && visibleIssue && firstSuggestion) {
                    event.preventDefault();
                    applySuggestion(visibleIssue, firstSuggestion);
                    return;
                  }
                  if (plainTab && ghost) {
                    event.preventDefault();
                    const next = answerText + ghost.tail;
                    updateValue(next);
                    setCaret(next.length);
                    setDismissed(null);
                    requestAnimationFrame(() => {
                      ref.current?.setSelectionRange(next.length, next.length);
                    });
                    return;
                  }
                  if (plainTab && !event.shiftKey && !question) {
                    const area = ref.current;
                    if (!area) return;
                    event.preventDefault();
                    const start = area.selectionStart;
                    const end = area.selectionEnd;
                    const caretNext = start + 2;
                    updateValue(`${answerText.slice(0, start)}  ${answerText.slice(end)}`);
                    setCaret(caretNext);
                    setDismissed(null);
                    requestAnimationFrame(() => {
                      ref.current?.setSelectionRange(caretNext, caretNext);
                    });
                    return;
                  }
                  if (event.key === "Escape" && visibleIssue) {
                    event.preventDefault();
                    event.stopPropagation();
                    setDismissed(issueKey(visibleIssue));
                    setHintRect(null);
                    return;
                  }
                  if (event.key === "Escape") {
                    ref.current?.blur();
                    return;
                  }
                  if (
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    !coarse &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    if (question) advanceForm();
                    else void submit();
                  }
                }}
              />
              <ComposerHighlights
                ref={highlightRef}
                value={answerText}
                issues={issues}
                active={visibleIssue}
                askRange={askRange}
                ghost={ghost?.tail ?? null}
                onRect={onHintRect}
              />
              {visibleIssue && hintRect && (
                <div
                  role="group"
                  aria-label={`Suggestions for ${visibleIssue.word}`}
                  title={visibleIssue.message}
                  onMouseDown={(event) => event.preventDefault()}
                  className="border-border bg-popover text-foreground absolute z-20 flex items-center gap-1 rounded-md border px-1.5 py-1 text-[11px] whitespace-nowrap shadow-lg"
                  style={{
                    left: Math.max(
                      4,
                      Math.min(
                        hintRect.left + hintRect.width + 6,
                        (ref.current?.clientWidth ?? 700) - 230,
                      ),
                    ),
                    top: hintTop,
                  }}
                >
                  <span className="text-muted-foreground">→</span>
                  {visibleIssue.suggestions.length > 0 ? (
                    visibleIssue.suggestions.slice(0, 3).map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        onClick={() => applySuggestion(visibleIssue, suggestion)}
                        className="text-muted-foreground hover:bg-accent hover:text-foreground rounded px-1 py-0.5"
                      >
                        {suggestion}
                      </button>
                    ))
                  ) : (
                    <span className="text-muted-foreground">no suggestions</span>
                  )}
                  <span className="text-border">·</span>
                  <button
                    type="button"
                    onClick={() => ignoreWord(visibleIssue.word)}
                    className="text-muted-foreground hover:text-foreground underline"
                  >
                    ignore
                  </button>
                </div>
              )}
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
            <span aria-live="polite" className="hidden text-[11px] text-muted-foreground sm:inline">
              {question
                ? customAnswer
                  ? coarse
                    ? "Answer with the button · Enter for a new line"
                    : "Enter to answer · Shift+Enter for a new line"
                  : "Pick an option above"
                : coarse
                  ? "Send with the button · Enter for a new line"
                  : running
                    ? "Enter steers into the run · hold Shift a second, then click Send to queue"
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
                  {step > 0 && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={previousQuestion}
                      disabled={formBusy}
                    >
                      Back
                    </Button>
                  )}
                  {!lastQuestion ? (
                    <Button
                      size="sm"
                      onClick={advanceForm}
                      disabled={formBusy || (question.required && !value.trim())}
                    >
                      Next
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => void answerForm()}
                      disabled={formBusy || (question.required && !value.trim())}
                    >
                      {formBusy ? <Loader2 className="animate-spin" /> : <Check />}
                      Answer
                    </Button>
                  )}
                </>
              ) : (
                <Button
                  size="sm"
                  variant={queue ? "secondary" : "default"}
                  onClick={() => void submit()}
                  disabled={
                    !workspace ||
                    disabled ||
                    (!value.trim() && readyFiles.length === 0) ||
                    submitting
                  }
                  title={
                    queue
                      ? "Send after this run finishes"
                      : running
                        ? "Steer into the running turn · hold Shift a second to queue"
                        : undefined
                  }
                  aria-label={queue ? "Queue after this run" : running ? "Steer message" : "Send"}
                >
                  {submitting ? <Loader2 className="animate-spin" /> : <ArrowUp />}
                  {queue ? "Queue" : running ? "Steer" : "Send"}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {cropItem?.preview && cropItem.file && (
        <ImageCrop
          src={cropItem.preview}
          name={cropItem.name}
          file={cropItem.file}
          onApply={(file) => applyCrop(cropItem.id, file)}
          onClose={() => setCropId(null)}
        />
      )}
    </div>
  );
});
