import type { TaskNotesClient } from "../data/api/TaskNotesClient";
import { useApiClient } from "../state/ApiClientContext";

export function useTaskNotesClient(): TaskNotesClient | null {
  return useApiClient();
}
