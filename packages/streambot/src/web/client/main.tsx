import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./app.tsx";
import { ErrorBoundary } from "./telemetry/error-boundary.tsx";
import "./styles/theme.css";
import "./styles/base.css";
import "./styles/button.css";

const root = document.querySelector("#root");
if (root === null) throw new Error("Streambot root element is missing");
createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
);
