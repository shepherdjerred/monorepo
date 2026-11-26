import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createThemeStore } from "@shepherdjerred/console-ui";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { createQueryClient } from "./api.ts";
import { App } from "./app.tsx";
import "@shepherdjerred/console-ui/styles/index.css";
import "./styles.css";

const queryClient = createQueryClient();

const theme = createThemeStore("flags-theme");

const root = document.querySelector("#root");
if (root === null) throw new Error("flags page is missing #root");

// Location updates render synchronously (no transition) so the URL-backed
// search field stays a well-behaved controlled input while typing.
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter useTransitions={false}>
        <App theme={theme} />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
