import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app.tsx";
import "./styles/tokens.css";
import "./styles/layout.css";
import "./styles/components.css";

const root = document.querySelector("#root");
if (root === null) {
  throw new Error("storm-stats page is missing #root");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
