import { collectDefaultMetrics, Registry } from "prom-client";

export const register = new Registry();
register.setDefaultLabels({ app: "streambot" });
collectDefaultMetrics({ register, prefix: "streambot_" });
