---
title: Route a service to Braintrust
description: Add a service's LLM traces to a Braintrust project through the alloy-gateway allowlist, and verify the result.
---

Braintrust receives only whole LLM traces that an explicit gateway allowlist
branch claims; this page adds a service to one.

1. Pick the destination project. Reuse an existing branch when the service
   belongs to one (`misc` collects small tools). A new project needs a new
   entry in `BRAINTRUST_BRANCHES` in
   [`alloy-gateway.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/cdk8s/src/resources/argo-applications/observability/alloy-gateway.ts).
2. Write the branch's `drop` conditions as the negation of "belongs to this
   project", matched on `resource.attributes["service.name"]`. Equality
   comparisons handle a nil service name safely.
3. Repoint the producer, from `misc/otlp.ts`. Check whether the producer's
   own endpoint-construction code already appends `/v1/traces` before the
   request goes out — for example
   [`temporal/src/observability/tracing.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/temporal/src/observability/tracing.ts)
   builds its exporter `url` as `` `${otlpEndpoint}/v1/traces` `` in code. If
   it does, the producer needs the bare `OTLP_GATEWAY_BASE_URL`. If it POSTs
   to a URL used as given — a raw `fetch` producer, or an exporter configured
   with a complete endpoint — it needs `OTLP_GATEWAY_TRACES_URL`. Its egress
   NetworkPolicy (if any) selects the `alloy-gateway` namespace on port 4318
   instead of `tempo`.
4. Validate the rendered River config with the pinned Alloy binary before
   merging — CI does not parse River:

   ```bash
   cd packages/homelab/src/cdk8s
   bun -e 'import { ALLOY_GATEWAY_CONFIG } from "./src/resources/argo-applications/observability/alloy-gateway.ts";
   await Bun.write("/tmp/config.alloy", ALLOY_GATEWAY_CONFIG);'
   docker run --rm -e BRAINTRUST_API_KEY=dummy -v /tmp:/cfg grafana/alloy:v1.18.1 validate /cfg/config.alloy
   ```

5. Check the byte budget before adding a heavy producer. Estimate with the
   service's `llm_tokens_total` rate and compare against the Braintrust plan's
   monthly ingest allowance on its usage page.
6. Merge; the main pipeline releases it. Then verify: the service's traces
   still land in Tempo, `otelcol_exporter_sent_spans_total` for the new
   `bt_<project>` exporter increases after LLM activity while
   `otelcol_exporter_send_failed_spans_total` stays absent, and the project
   shows the whole trace with a root span.

:::caution
Project names are exact-match and created implicitly on first write — a typo
silently creates a stray project. `IsMatch` conditions error on a nil
service name and `error_mode=ignore` then skips only that condition, leaking
spans into the project; keep a `service.name == nil` drop guard listed first.
:::

If a branch overruns the byte budget, remove it from the
`tail_sampling.output` list — the config reloader applies that without
recreating the pod. Never add a catch-all branch; unlisted services staying
out of Braintrust is the exclusion mechanism.

## Related

- [LLM stack](/explanation/llm-stack/) — why the gateway and sampling are
  shaped this way.
