import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PromotionPage } from "./page.tsx";
import "#styles/globals.css";
import "./promotion.css";

const root = document.querySelector("#root");
if (root === null) throw new Error("Missing root element");
const client = new QueryClient({ defaultOptions: { queries: { retry: 1 } } });
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <PromotionPage />
    </QueryClientProvider>
  </StrictMode>,
);
