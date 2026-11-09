import { useEffect, useRef } from "react";
import type { Session } from "../lib/types";

const TITLE = "nit-gui";

function chime() {
  try {
    const context = new AudioContext();
    const tone = context.createOscillator();
    const gain = context.createGain();
    tone.frequency.value = 880;
    gain.gain.setValueAtTime(0.06, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.25);
    tone.connect(gain).connect(context.destination);
    tone.start();
    tone.stop(context.currentTime + 0.25);
    tone.onended = () => void context.close();
  } catch {
    return;
  }
}

function notify(title: string, session: Session | undefined, onOpen: (id: string) => void, tag: string): boolean {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return false;
  try {
    const note = new Notification(title, {
      body: session?.title?.trim() || "nit-gui",
      tag,
    });
    note.onclick = () => {
      window.focus();
      if (session) onOpen(session.id);
      note.close();
    };
    return true;
  } catch {
    return false;
  }
}

type AttentionOptions = {
  enabled: boolean;
  ready: boolean;
  sessions: Session[];
  doneIds?: ReadonlySet<string>;
  onOpen: (id: string) => void;
};

export function useAttention(
  waitingIds: Set<string>,
  { enabled, ready, sessions, doneIds, onOpen }: AttentionOptions,
) {
  const previous = useRef(waitingIds);
  const previousDone = useRef(doneIds ?? new Set<string>());
  const waitingBaseline = useRef(!ready);
  const doneBaseline = useRef(!ready);
  const open = useRef(onOpen);
  open.current = onOpen;
  const list = useRef(sessions);
  list.current = sessions;

  useEffect(() => {
    document.title = waitingIds.size > 0 ? `(${waitingIds.size}) ${TITLE}` : TITLE;
  }, [waitingIds]);

  useEffect(() => {
    const fresh = [...waitingIds].find((id) => !previous.current.has(id));
    previous.current = waitingIds;
    if (!ready) {
      waitingBaseline.current = true;
      return;
    }
    if (waitingBaseline.current) {
      waitingBaseline.current = false;
      return;
    }
    if (!fresh || !enabled || (!document.hidden && document.hasFocus())) return;
    const session = list.current.find((item) => item.id === fresh);
    if (notify("Waiting for your answer", session, open.current, "nit-gui-waiting")) return;
    chime();
  }, [waitingIds, enabled, ready]);

  useEffect(() => {
    const done = doneIds ?? new Set<string>();
    const fresh = [...done].find((id) => !previousDone.current.has(id));
    previousDone.current = done;
    if (!ready) {
      doneBaseline.current = true;
      return;
    }
    if (doneBaseline.current) {
      doneBaseline.current = false;
      return;
    }
    if (!fresh || !enabled || waitingIds.has(fresh)) return;
    if (!document.hidden && document.hasFocus()) return;
    const session = list.current.find((item) => item.id === fresh);
    if (notify("Run finished", session, open.current, "nit-gui-done")) return;
    chime();
  }, [doneIds, enabled, waitingIds, ready]);
}
