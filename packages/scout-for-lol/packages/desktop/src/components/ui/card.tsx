import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@scout-for-lol/desktop/lib/utils";

type CardProps = HTMLAttributes<HTMLDivElement> & {
  variant?: "default" | "glass" | "bordered";
};

function Card({ className, variant = "default", ...props }: CardProps) {
  const variantStyles = {
    default: "bg-gray-800/80 border-gray-700/50",
    glass: "bg-gray-800/40 backdrop-blur-md border-gray-700/30",
    bordered: "bg-gray-800/60 border-gray-600",
  };

  return (
    <div
      className={cn(
        "rounded-xl border shadow-lg",
        variantStyles[variant],
        className,
      )}
      {...props}
    />
  );
}

type CardHeaderProps = HTMLAttributes<HTMLDivElement> & {
  action?: ReactNode;
};

function CardHeader({
  className,
  action,
  children,
  ...props
}: CardHeaderProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-between border-b border-gray-700/50 px-6 py-6",
        className,
      )}
      {...props}
    >
      <div className="flex flex-col gap-2">{children}</div>
      {Boolean(action) && <div>{action}</div>}
    </div>
  );
}

type CardTitleProps = HTMLAttributes<HTMLHeadingElement> & {
  icon?: ReactNode;
};

function CardTitle({ className, icon, children, ...props }: CardTitleProps) {
  return (
    <h3
      className={cn(
        "flex items-center gap-2.5 text-lg font-semibold text-gray-100",
        className,
      )}
      {...props}
    >
      {Boolean(icon) && <span className="text-discord-blurple">{icon}</span>}
      {children}
    </h3>
  );
}

function CardDescription({
  className,
  ...props
}: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-sm text-gray-400", className)} {...props} />;
}

function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-6 py-6", className)} {...props} />;
}

function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 border-t border-gray-700/50 px-6 py-5",
        className,
      )}
      {...props}
    />
  );
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardDescription,
  CardContent,
};
