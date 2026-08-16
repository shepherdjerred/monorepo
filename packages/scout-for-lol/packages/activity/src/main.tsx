import { createRoot } from "react-dom/client";
import { App } from "@/app";
import { ActivityApiProvider } from "@/lib/activity-api";
import { ActivitySessionProvider } from "@/lib/activity-session";
import { TooltipProvider } from "@/components/ui/tooltip";
import "@/index.css";

const root = document.querySelector("#root");
if (root === null) throw new Error("Missing #root mount point");

createRoot(root).render(
  <ActivitySessionProvider>
    <ActivityApiProvider>
      <TooltipProvider>
        <App />
      </TooltipProvider>
    </ActivityApiProvider>
  </ActivitySessionProvider>,
);
