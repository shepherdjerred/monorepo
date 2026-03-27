import { cn } from "@/lib/utils";

type SkeletonProps = {
  className?: string | undefined;
};

export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-md bg-zinc-200 dark:bg-zinc-700",
        className,
      )}
    />
  );
}
