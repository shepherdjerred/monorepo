import "@shepherdjerred/console-ui/styles/index.css";
import "./styles.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./app.tsx";
import { themeStore } from "./theme.ts";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 15_000,
    },
  },
});

const root = document.querySelector("#root");
if (root === null) {
  throw new Error("Errors client is missing #root element");
}

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App store={themeStore} />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
