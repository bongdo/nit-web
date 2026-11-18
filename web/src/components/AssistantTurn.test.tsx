import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AssistantTurn } from "./AssistantTurn";
import type { Message } from "../lib/types";

const turn = {
  id: "msg_1",
  type: "assistant",
  time: { created: 1 },
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
} as Message;

const render = () =>
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
    />,
  );

describe("AssistantTurn steps", () => {
  it("shows the answer with a single steps chip", () => {
    const html = render();
    expect(html).toContain("Fixed the flaky test.");
    expect(html).toContain(`Steps · 2`);
    expect(html).not.toContain("Checking the failing test first.");
    expect(html).not.toContain("bin/check");
    expect(html).not.toContain("Activity</span>");
  });
});
