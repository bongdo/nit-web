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

function notify(session: Session | undefined, onOpen: (id: string) => void): boolean {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return false;
  try {
    const note = new Notification("Waiting for your answer", {
      body: session?.title?.trim() || "nit-gui",
      tag: "nit-gui-waiting",
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
  sessions: Session[];
  onOpen: (id: string) => void;
};

export function useAttention(
  waitingIds: Set<string>,
  { enabled, sessions, onOpen }: AttentionOptions,
) {
  const previous = useRef(waitingIds);
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
    if (!fresh || (!document.hidden && document.hasFocus())) return;
    const session = list.current.find((item) => item.id === fresh);
    if (enabled && notify(session, open.current)) return;
    chime();
  }, [waitingIds, enabled]);
}
