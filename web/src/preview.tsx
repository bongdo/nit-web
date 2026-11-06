import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { AssistantTurn } from "./components/AssistantTurn";
import type { Message } from "./lib/types";

const path = "/home/ubuntu/Projects/nit-gui/internal/server/server_test.go";

const completed: Message = {
  id: "msg_completed",
  type: "assistant",
  agent: "build",
  time: { created: 1_000_000, completed: 1_137_000 },
  content: [
    {
      type: "reasoning",
      text: "Check how the server test wires the fake OpenCode client before changing the handler.\nThe assertion probably needs the new route.",
    },
    {
      type: "tool",
      id: "t1",
      name: "read",
      state: { status: "completed", input: { path }, content: [{ type: "text", text: "package server" }] },
    },
    {
      type: "reasoning",
      text: "The test creates the handler directly, so I can add the route without touching main.go.",
    },
    {
      type: "tool",
      id: "t2",
      name: "edit",
      state: {
        status: "completed",
        input: { filePath: path, oldString: "old", newString: "new" },
        content: [{ type: "text", text: "Edit applied" }],
      },
    },
    {
      type: "tool",
      id: "t3",
      name: "shell",
      state: {
        status: "completed",
        input: { command: "gofmt -w internal/server/server.go internal/opencode/client.go && go test ./internal/..." },
        content: [{ type: "text", text: "ok" }],
      },
    },
    { type: "text", text: "Обновил тест и прогнал проверки." },
  ],
};

const running: Message = {
  id: "msg_running",
  type: "assistant",
  agent: "build",
  time: { created: 2_000_000, streamed: 2_012_000 },
  content: [
    {
      type: "reasoning",
      text: "Now I need to confirm the compact activity rows still show the full command when expanded.",
    },
    {
      type: "tool",
      id: "t4",
      name: "shell",
      state: { status: "running", input: { command: "go test ./internal/server -run TestActivity" } },
    },
  ],
};

const agents = [{ id: "build", name: "build" }];

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <main className="bg-background text-foreground mx-auto max-w-3xl px-6 py-10">
      <AssistantTurn
        messages={[completed]}
        models={[]}
        agents={agents}
        workspace="/home/ubuntu/Projects/nit-gui"
        streaming={false}
        onRevert={() => {}}
        onFork={() => {}}
      />
      <AssistantTurn
        messages={[running]}
        models={[]}
        agents={agents}
        workspace="/home/ubuntu/Projects/nit-gui"
        streaming
        onRevert={() => {}}
        onFork={() => {}}
      />
    </main>
  </StrictMode>,
);

if (new URLSearchParams(location.search).has("open")) {
  window.setTimeout(() => {
    document.querySelector<HTMLButtonElement>("button[aria-expanded]")?.click();
  }, 100);
}
