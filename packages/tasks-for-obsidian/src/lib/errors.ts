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

export function showBulkResultErrors(
  results: readonly { readonly ok: boolean }[],
  total: number,
  title: string,
): boolean {
  const failed = results.filter((result) => !result.ok).length;
  if (failed === 0) return false;
  feedbackError();
  Alert.alert(
    title,
    `${String(failed)} of ${String(total)} task${total === 1 ? "" : "s"} could not be updated. They may have been renamed or deleted in Obsidian.`,
  );
  return true;
}
