// First, before the application: this stylesheet declares the cascade layer
// order, which the browser fixes at the first `@layer` it meets. Feature
// stylesheets arrive through `app.tsx` and must come after it.
import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { App } from "./app.tsx";
import { queryClient } from "./api.ts";

const root = document.querySelector("#root");
if (root === null) throw new Error("Application root is missing");
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
