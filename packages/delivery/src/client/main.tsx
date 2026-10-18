import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./app.tsx";
import "./styles.css";

const root = document.querySelector("#root");
if (root === null) throw new Error("Delivery root element is missing");
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchInterval: 10_000 } },
});

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
