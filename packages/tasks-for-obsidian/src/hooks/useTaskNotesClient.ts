import { useMemo } from "react";

import { TaskNotesClient } from "../data/api/TaskNotesClient";
import { useSettings } from "./useSettings";

export function useTaskNotesClient(): TaskNotesClient | null {
  const { apiUrl } = useSettings();
  return useMemo(() => (apiUrl ? new TaskNotesClient({ baseUrl: apiUrl }) : null), [apiUrl]);
}
