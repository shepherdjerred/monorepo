import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";

import { DocumentChanges } from "./document-changes.tsx";
import { loadDocumentPage } from "./route-loaders.ts";
import { RouteNotFound } from "./route-not-found.tsx";
import { Skeleton } from "#components/ui/skeleton";
import { Toaster } from "#components/ui/sonner";

const BoardPage = lazy(async () => {
  const module = await import("./board-page.tsx");
  return { default: module.BoardPage };
});

const DocumentPage = lazy(loadDocumentPage);

function RouteFallback(): React.JSX.Element {
  return (
    <main className="mx-auto min-h-svh max-w-6xl space-y-5 p-5 md:p-8">
      <Skeleton className="h-9 w-32" />
      <Skeleton className="h-20 w-3/4" />
      <Skeleton className="h-[55vh] w-full rounded-2xl" />
    </main>
  );
}

export function App(): React.JSX.Element {
  return (
    <>
      <DocumentChanges />
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route element={<BoardPage />} path="/" />
          <Route element={<DocumentPage />} path="/documents/:id" />
          <Route element={<RouteNotFound />} path="*" />
        </Routes>
      </Suspense>
      <Toaster position="bottom-right" richColors />
    </>
  );
}
