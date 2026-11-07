import { memo } from "react";
import type { ToolPart } from "../lib/types";
import { questionRecords } from "../lib/questions";
import { timeLabel, type TimeFormat } from "../lib/time";
import { cn } from "../lib/utils";

export const QuestionCard = memo(function QuestionCard({
  part,
  timeFormat,
  showTime,
}: {
  part: ToolPart;
  timeFormat: TimeFormat;
  showTime: boolean;
}) {
  const questions = questionRecords(part);
  if (questions.length === 0) return null;
  const pending = part.state.status === "running" || part.state.status === "streaming";
  const answered = questions.some((question) => question.answers.length > 0);
  if (pending && !answered) return null;
  const complete = questions.every((question) => question.answers.length > 0);
  const answeredAt = part.time?.completed ?? part.time?.ran ?? part.time?.created;

  return (
    <div className="my-3 space-y-3">
      {questions.map((question, index) => (
        <div key={index} className="space-y-1.5">
          {question.header && (
            <div className="text-muted-foreground text-[11px]">{question.header}</div>
          )}
          <div className="text-sm">{question.question}</div>
          {question.answers.length > 0 ? (
            <div className="flex justify-end">
              <div className="bg-secondary max-w-[85%] min-w-0 rounded-2xl rounded-br-sm px-3 py-2 text-sm shadow-sm">
                <div className="border-primary/70 mb-1.5 border-l-2 pl-2">
                  <div className="text-primary text-[11px] leading-4 font-medium">Assistant</div>
                  <div className="text-muted-foreground line-clamp-2 text-xs leading-4">
                    {question.question}
                  </div>
                </div>
                <div className="whitespace-pre-wrap">{question.answers.join(", ")}</div>
                {showTime && answeredAt ? (
                  <div className="text-muted-foreground mt-1 text-right text-[10px] leading-none">
                    {timeLabel(answeredAt, timeFormat)}
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            question.options.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-xs">
                {question.options.map((option, optionIndex) => (
                  <li
                    key={optionIndex}
                    className={cn("text-muted-foreground flex gap-1.5", !complete && "opacity-80")}
                  >
                    <span className="shrink-0">○</span>
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
                ))}
              </ul>
            )
          )}
        </div>
      ))}
    </div>
  );
});
