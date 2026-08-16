import { createRoot } from "react-dom/client";
import { ScoutPortalProvider } from "@scout-for-lol/design-system/components/portal";
import { TooltipProvider } from "@scout-for-lol/design-system/components/tooltip";
import { ScoutThemeProvider } from "@scout-for-lol/design-system/runtime";
import { App } from "@/app";
import { ActivityApiProvider } from "@/lib/activity-api";
import { ActivitySessionProvider } from "@/lib/activity-session";
import "@/index.css";

const root = document.querySelector("#root");
if (root === null) throw new Error("Missing #root mount point");
const overlayRoot = document.querySelector<HTMLElement>(
  "#activity-overlay-root",
);
if (overlayRoot === null) throw new Error("Missing #activity-overlay-root");

createRoot(root).render(
  <ScoutThemeProvider surface="activity">
    <ScoutPortalProvider container={overlayRoot}>
      <ActivitySessionProvider>
        <ActivityApiProvider>
          <TooltipProvider delayDuration={0}>
            <App />
          </TooltipProvider>
        </ActivityApiProvider>
      </ActivitySessionProvider>
    </ScoutPortalProvider>
  </ScoutThemeProvider>,
);
