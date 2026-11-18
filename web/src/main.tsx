import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import FilePreview from "./FilePreview";
import Root from "./Root";
import { setInstance } from "./lib/api";
import { markNative } from "./lib/native";
import "./index.css";

markNative();

const preview = /\/view\/?$/.test(window.location.pathname);
if (preview) setInstance(new URLSearchParams(window.location.search).get("instance") ?? "");

createRoot(document.getElementById("root")!).render(
  <StrictMode>{preview ? <FilePreview /> : <Root />}</StrictMode>,
);
