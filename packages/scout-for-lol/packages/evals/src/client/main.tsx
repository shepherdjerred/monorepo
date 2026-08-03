import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import "@fontsource-variable/geist";

import { App } from "#client/app.tsx";
import { trpcClient, TRPCProvider } from "#client/trpc.ts";
import "#styles/globals.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 15_000 },
  },
});

const root = document.querySelector("#root");
if (root === null) throw new Error("Missing #root element");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TRPCProvider queryClient={queryClient} trpcClient={trpcClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </TRPCProvider>
    </QueryClientProvider>
  </StrictMode>,
);
