import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@shepherdjerred/console-ui/styles/index.css";
import { createThemeStore } from "@shepherdjerred/console-ui";
import { App } from "./app.tsx";
import "./styles.css";

const root = document.querySelector("#root");
if (root === null) {
  throw new Error("Missing #root mount element");
}

const theme = createThemeStore("ci-cache-theme");

createRoot(root).render(
  <StrictMode>
    <App theme={theme} />
  </StrictMode>,
);
