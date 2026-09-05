import { LoadingBlockDefaults } from "@shepherdjerred/loaded/react.tsx";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";

import { App } from "./app.tsx";
import { trpcClient, TRPCProvider } from "./trpc.ts";
import "#styles/globals.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 15_000 } },
});
const root = document.querySelector("#root");
if (root === null) throw new Error("Missing #root element");
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TRPCProvider queryClient={queryClient} trpcClient={trpcClient}>
        <LoadingBlockDefaults
          fallback={
            <main>
              <div className="loading-state">Loading…</div>
            </main>
          }
          renderError={() => (
            <main>
              <div className="error-state">Something went wrong.</div>
            </main>
          )}
        >
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </LoadingBlockDefaults>
      </TRPCProvider>
    </QueryClientProvider>
  </StrictMode>,
);
