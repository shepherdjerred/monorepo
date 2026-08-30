import { createRoot } from "react-dom/client";
import { ScoutThemeProvider } from "@scout-for-lol/design-system/runtime";
import { App } from "@/app";
import { ActivityApiProvider } from "@/lib/activity-api";
import { ActivitySessionProvider } from "@/lib/activity-session";
import "@/index.css";

const root = document.querySelector("#root");
if (root === null) throw new Error("Missing #root mount point");

createRoot(root).render(
  <ScoutThemeProvider surface="app">
    <ActivitySessionProvider>
      <ActivityApiProvider>
        <App />
      </ActivityApiProvider>
    </ActivitySessionProvider>
  </ScoutThemeProvider>,
);
