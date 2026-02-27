import { usePomodoroContext } from "../state/PomodoroContext";

export function usePomodoro() {
  return usePomodoroContext();
}
