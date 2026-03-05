import React, { createContext, useContext, useMemo } from "react";

import { TaskNotesClient } from "../data/api/TaskNotesClient";
import { useSettingsContext } from "./SettingsContext";

const ApiClientContext = createContext<TaskNotesClient | null>(null);

export function ApiClientProvider({ children }: { children: React.ReactNode }) {
  const { apiUrl, authToken } = useSettingsContext();

  const client = useMemo(
    () =>
      apiUrl
        ? new TaskNotesClient({
            baseUrl: apiUrl,
            authToken: authToken || undefined,
          })
        : null,
    [apiUrl, authToken],
  );

  return (
    <ApiClientContext.Provider value={client}>
      {children}
    </ApiClientContext.Provider>
  );
}

export function useApiClient(): TaskNotesClient | null {
  return useContext(ApiClientContext);
}
