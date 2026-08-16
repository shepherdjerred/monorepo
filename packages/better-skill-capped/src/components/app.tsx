import React from "react";
import { RouterProvider } from "@tanstack/react-router";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { persistOptions, queryClient } from "#src/lib/query-client";
import { router } from "#src/router";

export default function App(): React.ReactElement {
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={persistOptions}
    >
      <RouterProvider router={router} />
    </PersistQueryClientProvider>
  );
}
