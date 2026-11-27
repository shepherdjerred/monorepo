import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { App } from "#app/app.tsx";
import { registerOfflineShell } from "#app/offline-shell.ts";
import "#ui/styles.css";

const root = document.querySelector("#root");
if (root === null) throw new Error("TaskNotes is missing #root");
const router = createBrowserRouter([{ path: "*", element: <App /> }]);

createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
void registerOfflineShell();
