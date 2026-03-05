import { Alert } from "react-native";
import type { AppError } from "../domain/errors";
import type { Result } from "../domain/result";
import { feedbackError } from "./feedback";

export function showResultError<T>(
  result: Result<T, AppError>,
  title = "Error",
): boolean {
  if (result.ok) return false;
  feedbackError();
  Alert.alert(title, result.error.message);
  return true;
}
