import "./zod-config.ts";
import "@shepherdjerred/console-ui/styles/index.css";
import "./styles/base.css";
import "./styles/viewers.css";
import "./styles/review.css";
import "./styles/pages.css";

import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./app.tsx";
import { queryClient } from "./data/api.ts";

const root = document.querySelector("#root");
if (root === null) {
  throw new Error("Artifacts client is missing #root element");
}

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
