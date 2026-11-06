import { memo } from "react";
import { MessageCircleQuestion } from "lucide-react";
import type { ToolPart } from "../lib/types";
import { cn } from "../lib/utils";

type Question = {
  header?: string;
  question?: string;
  options?: { label?: string; description?: string }[];
};

function questionsOf(part: ToolPart): Question[] {
  const input = part.state.input;
  if (!input || typeof input !== "object") return [];
  const questions = (input as { questions?: unknown }).questions;
  return Array.isArray(questions) ? (questions as Question[]) : [];
}

function answersOf(part: ToolPart): string[][] {
  const metadata = part.state.metadata;
  if (!metadata || typeof metadata !== "object") return [];
  const answers = (metadata as { answers?: unknown }).answers;
  return Array.isArray(answers) ? (answers as string[][]) : [];
}

export const QuestionCard = memo(function QuestionCard({ part }: { part: ToolPart }) {
  const questions = questionsOf(part);
  if (questions.length === 0) return null;
  const answers = answersOf(part);
  const pending = part.state.status === "running" || part.state.status === "streaming";
  const content = (part.state.content ?? [])
    .map((item) => item.text)
    .filter(Boolean)
    .join("\n");
  const answered = answers.some((items) => items.length > 0);

  return (
    <div className="border-border bg-card my-2 rounded-lg border px-3 py-2 text-sm">
      <div className="text-muted-foreground mb-1.5 flex items-center gap-1.5 text-[11px]">
        <MessageCircleQuestion className="size-3.5" />
        Question
      </div>
      {questions.map((question, index) => {
        const selected = answers[index] ?? [];
        return (
          <div key={index} className="space-y-1 py-0.5">
            {question.header && (
              <div className="text-muted-foreground text-[11px]">{question.header}</div>
            )}
            <div className="font-medium">{question.question ?? "Question"}</div>
            {question.options && question.options.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-xs">
                {question.options.map((option, optionIndex) => {
                  const label = option.label ?? "";
                  const chosen = selected.includes(label);
                  return (
                    <li
                      key={optionIndex}
                      className={cn(
                        "flex gap-1.5",
                        chosen ? "text-foreground font-medium" : "text-muted-foreground",
                      )}
                    >
                      <span className="shrink-0">{chosen ? "•" : "○"}</span>
                      <span>
                        {label}
                        {option.description && (
                          <span className="text-muted-foreground font-normal">
                            {" "}
                            — {option.description}
                          </span>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            {selected.length > 0 && (
              <div className="text-foreground text-xs">Your answer: {selected.join(", ")}</div>
            )}
          </div>
        );
      })}
      {!answered && pending && (
        <div className="text-muted-foreground mt-1 text-xs">Waiting for your answer…</div>
      )}
      {!answered && !pending && content && (
        <div className="text-foreground mt-1 text-xs whitespace-pre-wrap">{content}</div>
      )}
    </div>
  );
});
