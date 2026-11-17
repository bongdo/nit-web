import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Message } from "../lib/types";
import { AssistantTurn } from "./AssistantTurn";

const turn: Message = {
  id: "msg_1",
  type: "assistant",
  time: { created: 1, completed: 2 },
  agent: "build",
  content: [
    { type: "reasoning", text: "Checking the failing test first." },
    {
      type: "tool",
      id: "tool_1",
      name: "bash",
      state: { status: "completed", input: { command: "bin/check" } },
    },
    { type: "text", text: "Fixed the flaky test." },
  ],
};

const render = (showSteps: boolean) =>
  renderToStaticMarkup(
    <AssistantTurn
      messages={[turn]}
      sessionID="ses_1"
      instance="local"
      models={[]}
      agents={[]}
      workspace="/work/app"
      peroURL="/pero/"
      streaming={false}
      timeFormat="24h"
      showTime={false}
      showSteps={showSteps}
    />,
  );

describe("AssistantTurn steps", () => {
  it("renders the steps summary and the answer by default", () => {
    const html = render(true);
    expect(html).toContain("2 steps · 1 tools");
    expect(html).toContain("Fixed the flaky test.");
    expect(html).not.toContain(">Steps · 2<");
  });

  it("keeps only the answer when agent steps are hidden", () => {
    const html = render(false);
    expect(html).toContain("Fixed the flaky test.");
    expect(html).not.toContain("Checking the failing test first.");
    expect(html).not.toContain("bin/check");
    expect(html).toContain(`Steps · 2`);
  });
});
