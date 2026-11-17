import { useEffect } from "react";
import type { Message } from "../lib/types";
import { chatText, loadIgnoredWords, mergeChatWords } from "../lib/chatWords";
import { learnWords } from "../lib/spell-client";

export function useChatDictionary(messages: Message[], ready: boolean) {
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      const text = chatText(messages);
      if (!text) return;
      void learnWords(text, loadIgnoredWords())
        .then((words) => {
          if (alive && words.length > 0) mergeChatWords(words);
        })
        .catch(() => undefined);
    }, 1500);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [messages, ready]);
}
