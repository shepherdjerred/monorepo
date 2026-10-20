import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { DeliveryClientError } from "#shared/client.ts";
import { createChangeFeed } from "./change-feed.ts";
import { createDeliveryRouter } from "./router.tsx";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/pipeline.css";
import "./styles/components.css";

/** Without a live change feed, visible data still refreshes. */
const FALLBACK_POLL_MS = 30_000;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: (failures, error) =>
        failures < 1 &&
        !(error instanceof DeliveryClientError && error.status < 500),
      refetchInterval: () =>
        feed.getSnapshot() === "live" ? false : FALLBACK_POLL_MS,
    },
  },
});
const feed = createChangeFeed(queryClient);
feed.start();
const router = createDeliveryRouter(queryClient, feed);
const root = document.querySelector("#root");
if (root === null) throw new Error("Delivery root element is missing");
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
