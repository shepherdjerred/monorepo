---
description: >-
  Use when asking about Tailscale ingress, exposing services on tailnet,
  Funnel public access, or private networking patterns.
---

# Tailscale Networking

## Overview

Services are exposed via Tailscale for secure private network access. The Tailscale Kubernetes
operator provides an ingress class that automatically provisions DNS entries on the tailnet.

## TailscaleIngress Construct

### Basic Usage (Private Access)

```typescript
import { TailscaleIngress } from "../misc/tailscale.ts";
import { Service } from "cdk8s-plus-31";

const service = new Service(chart, "myapp-service", {
  selector: deployment,
  ports: [{ port: 8080 }],
});

new TailscaleIngress(chart, "myapp-ingress", {
  service,
  host: "myapp",
});
```

**Result:** Service accessible at `myapp.tailnet-1a49.ts.net`

### Public Access via Funnel

```typescript
new TailscaleIngress(chart, "myapp-ingress", {
  service,
  host: "myapp",
  funnel: true, // Accessible from public internet
});
```

**Result:** Service accessible from public internet via Tailscale Funnel

## DNS Pattern

All services follow the pattern:

```text
{host}.tailnet-1a49.ts.net
```

Examples:

- `sonarr.tailnet-1a49.ts.net`
- `plex.tailnet-1a49.ts.net`
- `argocd.tailnet-1a49.ts.net`

## Implementation Details

```typescript
// From src/cdk8s/src/misc/tailscale.ts
export class TailscaleIngress extends Construct {
  constructor(
    scope: Construct,
    id: string,
    props: Partial<IngressProps> & {
      host: string;
      funnel?: boolean;
      service: Service | ServiceObject;
    },
  ) {
    super(scope, id);

    let base: IngressProps = {
      defaultBackend: IngressBackend.fromService(props.service as Service),
      tls: [{ hosts: [props.host] }],
    };

    if (props.funnel) {
      base = {
        ...base,
        metadata: {
          annotations: {
            "tailscale.com/funnel": "true",
          },
        },
      };
    }

    const ingress = new Ingress(scope, `${id}-ingress`, merge({}, base, props));

    // Set ingress class to Tailscale
    ApiObject.of(ingress).addJsonPatch(JsonPatch.add("/spec/ingressClassName", "tailscale"));
  }
}
```

## Alternative: createIngress Function

For ArgoCD applications or when you need more control:

```typescript
import { createIngress } from "../misc/tailscale.ts";

createIngress(
  chart,
  "myapp-ingress", // Ingress resource name
  "myapp-namespace", // Namespace
  "myapp-service", // Service name (string, not object)
  8080, // Port
  ["myapp"], // Hosts array
  false, // Funnel enabled
);
```

### Function Signature

```typescript
export function createIngress(
  chart: Chart,
  name: string,
  namespace: string,
  service: string,
  port: number,
  hosts: string[],
  funnel: boolean,
): KubeIngress;
```

## Common Patterns

### ArgoCD Application Ingress

```typescript
export function createArgoCdApp(chart: Chart) {
  // Create ingress for ArgoCD UI
  createIngress(
    chart,
    "argocd-ingress",
    "argocd",
    "argocd-server",
    443,
    ["argocd"],
    true, // Public access for external tools
  );

  // ... ArgoCD Application definition
}
```

### Multiple Ingresses for Same Deployment

```typescript
// Main service ingress
new TailscaleIngress(chart, "myapp-web-ingress", {
  service: webService,
  host: "myapp",
});

// Metrics ingress (separate port/service)
new TailscaleIngress(chart, "myapp-metrics-ingress", {
  service: metricsService,
  host: "myapp-metrics",
});
```

### External Service Reference

```typescript
new TailscaleIngress(chart, "external-ingress", {
  service: {
    name: "external-service",
    port: 443,
  } as unknown as Service,
  host: "external",
});
```

## Funnel Considerations

**When to use Funnel:**

- External webhook receivers
- Public-facing web apps
- GitHub Actions integrations
- OAuth callbacks

**When NOT to use Funnel:**

- Internal tools (Sonarr, Radarr, etc.)
- Admin dashboards (ArgoCD, Grafana)
- Database connections
- Sensitive services

## Tailscale Operator Configuration

The Tailscale operator is deployed via ArgoCD:

```typescript
// From src/cdk8s/src/resources/argo-applications/tailscale.ts
const tailscaleValues: HelmValuesForChart<"tailscale-operator"> = {
  oauth: {
    clientId: "...",
    clientSecret: "...",
  },
  operatorConfig: {
    hostname: "homelab-operator",
  },
};
```

## TLS Configuration

TLS is automatically handled by Tailscale:

```typescript
tls: [
  {
    hosts: [props.host],
    // No secretName needed - Tailscale provisions certs
  },
],
```

## Debugging

### Check Ingress Status

```bash
kubectl get ingress -A
kubectl describe ingress myapp-ingress -n media  # or appropriate namespace
```

### Check Tailscale Operator Logs

```bash
kubectl logs -n tailscale deployment/tailscale-operator
```

### Verify DNS Resolution

```bash
tailscale status
nslookup myapp.tailnet-1a49.ts.net
```

## Key Files

- `src/cdk8s/src/misc/tailscale.ts` - TailscaleIngress construct and createIngress function
- `src/cdk8s/src/resources/argo-applications/tailscale.ts` - Tailscale operator deployment
