import { Alert } from "#src/components/alert.tsx";
import { Button } from "#src/components/button.tsx";
import { EmptyState } from "#src/layout/index.tsx";
import { Spinner } from "#src/components/spinner.tsx";

export function LoadingState(props: { label?: string }) {
  return (
    <EmptyState>
      <Spinner />
      <p>{props.label ?? "Loading…"}</p>
    </EmptyState>
  );
}
export function ErrorState(props: {
  title?: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <EmptyState>
      <Alert tone="danger">
        <h3>{props.title ?? "Something went wrong"}</h3>
        <p>{props.message}</p>
      </Alert>
      {props.onRetry === undefined ? null : (
        <Button onClick={props.onRetry}>Try again</Button>
      )}
    </EmptyState>
  );
}
export function PermissionState(props: {
  message?: string;
  action?: React.ReactNode;
}) {
  return (
    <EmptyState>
      <h2>Permission required</h2>
      <p>{props.message ?? "You don’t have access to this Scout workspace."}</p>
      {props.action}
    </EmptyState>
  );
}
