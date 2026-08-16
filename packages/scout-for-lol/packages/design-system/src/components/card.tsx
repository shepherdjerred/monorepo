import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "#src/lib/cn.ts";

export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("scout-card", className)} {...props} />
  ),
);
Card.displayName = "Card";

export function CardHeader({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("scout-card__header", className)} {...props} />;
}
export function CardTitle({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3 className={cn("scout-card__title", className)} {...props}>
      {children}
    </h3>
  );
}
export function CardDescription({
  className,
  ...props
}: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("scout-card__description", className)} {...props} />;
}
export function CardContent({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("scout-card__content", className)} {...props} />;
}
export function CardFooter({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("scout-card__footer", className)} {...props} />;
}
