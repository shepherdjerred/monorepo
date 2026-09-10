// The alloy-gateway Deployment is the single OTLP entry point for every
// in-cluster trace producer: it forwards all spans to Tempo and is the future
// fan-out for additional consumers. Producers must not point at Tempo
// directly, or they bypass that fan-out.
export const OTLP_GATEWAY_BASE_URL =
  "http://alloy-gateway.alloy-gateway.svc.cluster.local:4318";

// For producers that POST OTLP JSON to the traces path via fetch instead of an
// OTLP SDK exporter.
export const OTLP_GATEWAY_TRACES_URL = `${OTLP_GATEWAY_BASE_URL}/v1/traces`;
