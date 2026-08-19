import { Counter, Registry, collectDefaultMetrics } from "prom-client";

export const metricsRegister = new Registry();
metricsRegister.setDefaultLabels({ app: "birmel" });
collectDefaultMetrics({ register: metricsRegister, prefix: "birmel_" });

export const admissionClassifierTotal = new Counter({
  name: "birmel_admission_classifier_total",
  help: "Birmel admission classifier outcomes",
  labelNames: ["outcome"] as const,
  registers: [metricsRegister],
});

export const memoryExtractionTotal = new Counter({
  name: "birmel_memory_extraction_total",
  help: "Birmel post-response memory extraction outcomes",
  labelNames: ["outcome"] as const,
  registers: [metricsRegister],
});
