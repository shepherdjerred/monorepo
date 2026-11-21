import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app.tsx";
import "./styles.css";

const root = document.querySelector("#root");
if (root === null) {
  throw new Error("Missing #root mount element");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
