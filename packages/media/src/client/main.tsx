// First, before the application: this stylesheet declares the cascade layer
// order, which the browser fixes at the first `@layer` it meets. Feature
// stylesheets arrive through the routes and must come after it.
import "./styles/index.css";
// Next, before any module that builds a schema.
import "./startup/zod.ts";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./api.ts";
import { routes } from "./shell/routes.tsx";
import { initializeTheme } from "./shell/theme.ts";

// Before the first render, so a pinned theme is never painted wrong. This
// module is the page's only script: there is no inline one to do it earlier.
initializeTheme();

const root = document.querySelector("#root");
if (root === null) throw new Error("Application root is missing");
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={createBrowserRouter(routes)} />
    </QueryClientProvider>
  </StrictMode>,
);
