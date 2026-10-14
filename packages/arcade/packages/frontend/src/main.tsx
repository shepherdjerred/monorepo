import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./app.tsx";
import { GameErrorBoundary } from "./ui/error-boundary.tsx";
import "./style.css";

const root = document.querySelector("#root");
if (root === null) throw new Error("Arcade root element is missing");
const queryClient = new QueryClient();
createRoot(root).render(
  <QueryClientProvider client={queryClient}>
    <GameErrorBoundary>
      <App />
    </GameErrorBoundary>
  </QueryClientProvider>,
);
