import { Suspense } from "react";
import { Route, Routes } from "react-router";

import { registry } from "./modules.ts";
import type { ResolvedRoute } from "./platform/module.ts";
import { RegistryProvider } from "./platform/registry.tsx";
import { Shell } from "./shell.tsx";

function page(route: ResolvedRoute): React.JSX.Element {
  const Page = route.page;
  return (
    <Suspense
      fallback={
        <main>
          <div className="loading-state">Loading…</div>
        </main>
      }
    >
      <Page />
    </Suspense>
  );
}

function routeElement(route: ResolvedRoute): React.JSX.Element {
  return route.path === "/" ? (
    <Route key={route.path} index element={page(route)} />
  ) : (
    <Route key={route.path} path={route.path} element={page(route)} />
  );
}

export function App(): React.JSX.Element {
  return (
    <RegistryProvider registry={registry}>
      <Routes>
        {registry.routes
          .filter((route) => route.chrome === "bare")
          .map((route) => routeElement(route))}
        <Route element={<Shell nav={registry.nav} />}>
          {registry.routes
            .filter((route) => route.chrome === "shell")
            .map((route) => routeElement(route))}
          <Route
            path="*"
            element={
              <main>
                <div className="empty-state">Page not found.</div>
              </main>
            }
          />
        </Route>
      </Routes>
    </RegistryProvider>
  );
}
