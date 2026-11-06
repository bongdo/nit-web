import { useEffect, useRef } from "react";

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

export function useAttention(waitingIds: Set<string>) {
  const previous = useRef(waitingIds);

  useEffect(() => {
    document.title = waitingIds.size > 0 ? `(${waitingIds.size}) ${TITLE}` : TITLE;
  }, [waitingIds]);

  useEffect(() => {
    const fresh = [...waitingIds].some((id) => !previous.current.has(id));
    previous.current = waitingIds;
    if (!fresh || !document.hidden) return;
    chime();
  }, [waitingIds]);
}
