import { Link } from "react-router";
import { Button } from "@scout-for-lol/design-system/components/button";

export function invalidEditRecordRoute(
  guildId: string | undefined,
  isEdit: boolean,
  editIdIsValid: boolean,
): boolean {
  return guildId === undefined || (isEdit && !editIdIsValid);
}

export function editRecordNeedsLoad(
  isEdit: boolean,
  existingId: number | undefined,
  routeId: number,
  hydratedId: number | null,
): boolean {
  return isEdit && (existingId !== routeId || hydratedId !== routeId);
}

export function recordSubmitLabel(pending: boolean, isEdit: boolean): string {
  if (pending) return "Saving…";
  return isEdit ? "Save changes" : "Create";
}

export function recordFormTitle(
  recordName: "competition" | "report",
  isEdit: boolean,
): string {
  return isEdit ? `Edit ${recordName}` : `New ${recordName}`;
}

export function EditRecordQueryState(props: {
  recordName: "competition" | "report";
  listHref: string;
  error: { message: string } | null;
  onRetry: () => void;
}) {
  return (
    <div className="space-y-3">
      {props.error === null ? (
        <p role="status" className="text-sm text-scout-subtle">
          Loading {props.recordName}…
        </p>
      ) : (
        <div role="alert" className="space-y-2 text-sm text-scout-danger">
          <p>
            Couldn&apos;t load this {props.recordName}: {props.error.message}
          </p>
          <Button type="button" variant="outline" onClick={props.onRetry}>
            Retry
          </Button>
        </div>
      )}
      <Button asChild variant="outline" size="sm">
        <Link to={props.listHref}>Back to {props.recordName}s</Link>
      </Button>
    </div>
  );
}

export function EditRecordRefreshWarning(props: {
  recordName: "competition" | "report";
  error: { message: string } | null;
  hasSavedRecord: boolean;
  onRetry: () => void;
}) {
  if (props.hasSavedRecord && props.error !== null) {
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center gap-2 text-sm text-scout-danger"
      >
        <span>
          Couldn&apos;t refresh this {props.recordName}. Showing the saved
          values.
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={props.onRetry}
        >
          Retry
        </Button>
      </div>
    );
  }
  return null;
}
