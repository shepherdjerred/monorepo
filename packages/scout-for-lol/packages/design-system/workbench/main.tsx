import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "#styles/index.css";
import "./workbench.css";
import { ScoutThemeProvider } from "#src/runtime/context.tsx";
import { Workbench } from "./workbench.tsx";

const root = document.querySelector("#root");
if (root === null) throw new Error("Missing workbench root");
createRoot(root).render(
  <StrictMode>
    <ScoutThemeProvider surface="workbench">
      <Workbench />
    </ScoutThemeProvider>
  </StrictMode>,
);
