import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Route,
  Routes,
  useLocation,
  Navigate,
} from "react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { App } from "./app.tsx";
import { queryClient } from "./api.ts";
import "./styles.css";

const root = document.querySelector("#root");
function RoutedApp() {
  const location = useLocation();
  return <App key={location.pathname} />;
}
if (root === null) throw new Error("Missing application root");
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route
            path="/"
            element={
              <Navigate
                replace
                to={
                  localStorage.getItem("tracker.view") === "board"
                    ? "/board"
                    : "/issues"
                }
              />
            }
          />
          <Route path="/*" element={<RoutedApp />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
