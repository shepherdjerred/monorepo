import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createThemeStore } from "@shepherdjerred/console-ui";
import { createRoot } from "react-dom/client";
import { App } from "./app.tsx";
import "@shepherdjerred/console-ui/styles/index.css";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

const theme = createThemeStore("feeds-theme");

const root = document.querySelector("#root");
if (root === null) throw new Error("feeds page is missing #root");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App theme={theme} />
    </QueryClientProvider>
  </StrictMode>,
);
