/**
 * Minimal Suspense fallback for a routed section — matches the muted
 * "Loading…" text the sections rendered inline before they moved to
 * `useSuspenseQuery`.
 */
export function SectionSkeleton() {
  return (
    <p role="status" className="text-sm text-muted-foreground">
      Loading…
    </p>
  );
}
