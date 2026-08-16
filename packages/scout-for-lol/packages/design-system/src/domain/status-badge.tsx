import { Badge } from "#src/components/badge.tsx";

export type ScoutStatus = "success" | "warning" | "danger" | "info" | "neutral";
export function StatusBadge(props: {
  status: ScoutStatus;
  children: React.ReactNode;
}) {
  const variant =
    props.status === "danger"
      ? "destructive"
      : props.status === "neutral"
        ? "secondary"
        : "outline";
  return (
    <Badge variant={variant} data-status={props.status}>
      {props.children}
    </Badge>
  );
}
