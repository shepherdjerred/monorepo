import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "#styles/index.css";
import "./workbench.css";
import { ScoutThemeProvider } from "#src/runtime/context.tsx";
import { PromotedControlsCatalog } from "./promoted-controls.tsx";
import { Workbench } from "./workbench.tsx";

const root = document.querySelector("#root");
if (root === null) throw new Error("Missing workbench root");
const content =
  globalThis.location.pathname === "/promoted-controls" ? (
    <PromotedControlsCatalog />
  ) : (
    <Workbench />
  );
createRoot(root).render(
  <StrictMode>
    <ScoutThemeProvider surface="workbench">{content}</ScoutThemeProvider>
  </StrictMode>,
);
