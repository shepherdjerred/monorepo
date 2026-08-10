import { Registry, collectDefaultMetrics } from "prom-client";

export const metricsRegister = new Registry();
metricsRegister.setDefaultLabels({ app: "birmel" });
collectDefaultMetrics({ register: metricsRegister, prefix: "birmel_" });
