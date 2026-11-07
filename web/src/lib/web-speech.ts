export type DictationMode = "instant" | "fast" | "accurate";

type SpeechResult = {
  isFinal: boolean;
  length: number;
  [index: number]: { transcript: string };
};

type SpeechEvent = {
  resultIndex: number;
  results: { length: number; [index: number]: SpeechResult };
};

export type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};

type RecognitionCtor = new () => SpeechRecognitionLike;

export function speechRecognition(): RecognitionCtor | null {
  const scope = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

export function dictationText(base: string, spoken: string, interim: string): string {
  let text = base;
  for (const part of [spoken, interim]) {
    const clean = part.trim();
    if (!clean) continue;
    text = !text ? clean : /\s$/.test(text) ? `${text}${clean}` : `${text} ${clean}`;
  }
  return text;
}
