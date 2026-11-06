import { memo } from "react";
import { MessageCircleQuestion } from "lucide-react";
import type { ToolPart } from "../lib/types";
import { questionRecords } from "../lib/questions";
import { cn } from "../lib/utils";

export const QuestionCard = memo(function QuestionCard({ part }: { part: ToolPart }) {
  const questions = questionRecords(part);
  if (questions.length === 0) return null;
  const pending = part.state.status === "running" || part.state.status === "streaming";
  const answered = questions.some((question) => question.answers.length > 0);
  if (pending && !answered) return null;

  return (
    <div className="border-border bg-card my-2 rounded-lg border px-3 py-2 text-sm">
      <div className="text-muted-foreground mb-1.5 flex items-center gap-1.5 text-[11px]">
        <MessageCircleQuestion className="size-3.5" />
        Question
      </div>
      {questions.map((question, index) => {
        const selected = question.answers;
        return (
          <div key={index} className="space-y-1 py-0.5">
            {question.header && (
              <div className="text-muted-foreground text-[11px]">{question.header}</div>
            )}
            <div className="font-medium">{question.question}</div>
            {question.options.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-xs">
                {question.options.map((option, optionIndex) => {
                  const chosen = selected.includes(option.label);
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
                        {option.label}
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
    </div>
  );
});
