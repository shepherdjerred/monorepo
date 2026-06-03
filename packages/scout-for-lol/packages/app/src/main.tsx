import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "#src/app.tsx";
import { TRPCProvider, trpcClient } from "#src/lib/trpc.ts";
import { ThemeProvider } from "#src/lib/use-theme.tsx";
import "#src/styles/global.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
});

const container = document.querySelector("#root");
if (container === null) {
  throw new Error("Missing #root mount point in index.html");
}

createRoot(container).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
          <BrowserRouter basename="/app">
            <App />
          </BrowserRouter>
        </TRPCProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
