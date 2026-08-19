import { memoryExtractionTotal } from "@shepherdjerred/birmel/observability/metrics.ts";

export async function memoryExtractionErrorCount(): Promise<number> {
  const metric = await memoryExtractionTotal.get();
  return (
    metric.values.find(({ labels }) => labels.outcome === "error")?.value ?? 0
  );
}
