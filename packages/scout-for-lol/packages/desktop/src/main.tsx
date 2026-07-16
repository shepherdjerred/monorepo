import * as Sentry from "@sentry/react";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./app.tsx";
import "./styles.css";

Sentry.init({
  dsn: "https://337945d2208840dca4a573be311a1bbb@bugsink.sjer.red/1",
  release: BUILD_SENTRY_RELEASE,
  environment: import.meta.env.MODE,
  // Bugsink is Sentry-compatible but does not support performance tracing.
  tracesSampleRate: 0,
});

const root = document.querySelector("#root");

if (!root) {
  throw new Error("Root element not found");
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <Sentry.ErrorBoundary fallback={<p>An error occurred</p>}>
      <App />
    </Sentry.ErrorBoundary>
  </React.StrictMode>,
);
