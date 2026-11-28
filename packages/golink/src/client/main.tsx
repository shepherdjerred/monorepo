import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import "@shepherdjerred/console-ui/styles/index.css";
import { createThemeStore } from "@shepherdjerred/console-ui";
import { createConsoleQueryClient } from "@shepherdjerred/console-client";
import { createGolinkRouter, missingSlugUrl } from "./router.tsx";
import { createGolinkTRPCClient, TRPCProvider } from "./trpc.ts";
import "./styles.css";

const root = document.querySelector("#root");
if (root === null) {
  throw new Error("Missing #root mount element");
}

// `go/<slug>` that did not resolve arrives here at `/<slug>`.
const rewritten = missingSlugUrl(
  globalThis.location.pathname,
  globalThis.location.search,
);
if (rewritten !== null) {
  globalThis.history.replaceState(null, "", rewritten);
}

const theme = createThemeStore("golink-theme");
const queryClient = createConsoleQueryClient();
const trpcClient = createGolinkTRPCClient();
const router = createGolinkRouter(theme);

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TRPCProvider queryClient={queryClient} trpcClient={trpcClient}>
        <RouterProvider router={router} />
      </TRPCProvider>
    </QueryClientProvider>
  </StrictMode>,
);
