import { cn } from "@/lib/utils";

type CardProps = {
  children: React.ReactNode;
  className?: string | undefined;
};

export function Card({ children, className }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-lg border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900",
        className,
      )}
    >
      {children}
    </div>
  );
}

type CardHeaderProps = {
  children: React.ReactNode;
  className?: string | undefined;
};

export function CardHeader({ children, className }: CardHeaderProps) {
  return (
    <div
      className={cn(
        "border-b border-zinc-200 px-6 py-4 dark:border-zinc-800",
        className,
      )}
    >
      {children}
    </div>
  );
}

type CardContentProps = {
  children: React.ReactNode;
  className?: string | undefined;
};

export function CardContent({ children, className }: CardContentProps) {
  return <div className={cn("px-6 py-4", className)}>{children}</div>;
}
