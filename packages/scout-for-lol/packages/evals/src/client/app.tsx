import { Link, Route, Routes } from "react-router";

import { CasePage } from "#client/case-page.tsx";
import { DatasetListPage } from "#client/dataset-list-page.tsx";
import { DatasetPage } from "#client/dataset-page.tsx";
import { FreshnessPage } from "#client/freshness-page.tsx";

function Shell({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="min-h-svh bg-white text-slate-950">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <Link className="text-sm font-semibold" to="/">
            Scout review evals
          </Link>
          <span className="text-xs text-slate-500">Local</span>
        </div>
      </header>
      {children}
    </div>
  );
}

export function App(): React.JSX.Element {
  return (
    <Shell>
      <Routes>
        <Route element={<DatasetListPage />} path="/" />
        <Route element={<DatasetPage />} path="/datasets/:datasetId" />
        <Route
          element={<CasePage />}
          path="/datasets/:datasetId/cases/:caseId"
        />
        <Route
          element={<FreshnessPage />}
          path="/datasets/:datasetId/freshness/:styleKey"
        />
        <Route
          element={
            <main className="mx-auto max-w-3xl p-8">
              <h1 className="text-3xl font-semibold">Page not found</h1>
              <Link className="mt-4 inline-block underline" to="/">
                Return to datasets
              </Link>
            </main>
          }
          path="*"
        />
      </Routes>
    </Shell>
  );
}
