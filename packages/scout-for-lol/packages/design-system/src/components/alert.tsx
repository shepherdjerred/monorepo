import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "#src/lib/cn.ts";

export function Alert(
  props: HTMLAttributes<HTMLDivElement> & {
    tone?: "info" | "success" | "warning" | "danger";
    icon?: ReactNode;
  },
) {
  const { className, icon, tone = "info", children, ...rest } = props;
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      data-tone={tone}
      className={cn("scout-alert", className)}
      {...rest}
    >
      {icon === undefined ? null : <span aria-hidden="true">{icon}</span>}
      <div>{children}</div>
    </div>
  );
}
export function AlertTitle({
  children,
  ...props
}: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 {...props}>{children}</h3>;
}
export function AlertDescription(props: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} />;
}
