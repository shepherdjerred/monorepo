# Plan: 100% Infrastructure-as-Code for Homelab

## Chosen Approach: CDK8s + Crossplane

**Why Crossplane?**

- TypeScript throughout (CDK8s generates Crossplane CRDs)
- Kubernetes-native (state lives in K8s, no external dependencies)
- GitOps via ArgoCD (already using)
- Production-ready (CNCF Incubating project)
- No external state system (unlike Pulumi/Terraform)

```text
TypeScript (CDK8s) → YAML (Crossplane CRDs) → ArgoCD → Crossplane → External APIs
```

---

## Implementation Plan

### Phase 1: Install Crossplane + Providers

#### 1.1 Install Crossplane via ArgoCD

```typescript
// src/cdk8s/src/resources/argo-applications/crossplane.ts
new Application(chart, "crossplane", {
  spec: {
    source: {
      repoUrl: "https://charts.crossplane.io/stable",
      chart: "crossplane",
      targetRevision: "1.15.0",
    },
    destination: {
      namespace: "crossplane-system",
    },
  },
});
```

#### 1.2 Install Providers

| Provider   | Package                                            | Resources                       |
| ---------- | -------------------------------------------------- | ------------------------------- |
| CloudFlare | `xpkg.upbound.io/upbound/provider-cloudflare`      | DNS records, tunnels, zones     |
| GitHub     | `xpkg.upbound.io/upbound/provider-github`          | Repos, teams, branch protection |
| HTTP       | `xpkg.upbound.io/crossplane-contrib/provider-http` | Any REST API (Postal, etc.)     |

```typescript
// src/cdk8s/src/resources/crossplane/providers.ts
new ApiObject(chart, "provider-cloudflare", {
  apiVersion: "pkg.crossplane.io/v1",
  kind: "Provider",
  metadata: { name: "provider-cloudflare" },
  spec: {
    package: "xpkg.upbound.io/upbound/provider-cloudflare:v0.15.0",
  },
});
```

#### 1.3 Configure Provider Credentials

```typescript
// Crossplane reads credentials from K8s secrets (via 1Password operator)
const cfCredentials = new OnePasswordItem(chart, "crossplane-cloudflare-creds", {
  spec: {
    itemPath: "vaults/v64ocnykdqju4ui6j6pua56xw4/items/sc5kj6xthlxmdn7k4mesdr2mju",
  },
});

new ApiObject(chart, "cloudflare-provider-config", {
  apiVersion: "cloudflare.upbound.io/v1beta1",
  kind: "ProviderConfig",
  metadata: { name: "default" },
  spec: {
    credentials: {
      source: "Secret",
      secretRef: {
        namespace: "crossplane-system",
        name: cfCredentials.name,
        key: "cloudflare-api-token",
      },
    },
  },
});
```

---

### Phase 2: CDK8s Constructs for External Resources

#### 2.1 CloudFlare DNS Records

```typescript
// src/cdk8s/src/constructs/cloudflare-dns.ts
import { Construct } from "constructs";
import { ApiObject } from "cdk8s";

export interface DnsRecordProps {
  zoneId: string;
  name: string;
  type: "A" | "AAAA" | "CNAME" | "MX" | "TXT" | "SRV";
  content: string;
  priority?: number;
  proxied?: boolean;
  ttl?: number;
}

export class CloudflareDnsRecord extends Construct {
  constructor(scope: Construct, id: string, props: DnsRecordProps) {
    super(scope, id);

    new ApiObject(this, "record", {
      apiVersion: "dns.cloudflare.upbound.io/v1alpha1",
      kind: "Record",
      metadata: { name: id },
      spec: {
        forProvider: {
          zoneId: props.zoneId,
          name: props.name,
          type: props.type,
          value: props.content,
          priority: props.priority,
          proxied: props.proxied ?? false,
          ttl: props.ttl ?? 1, // 1 = auto
        },
        providerConfigRef: { name: "default" },
      },
    });
  }
}
```

#### 2.2 Usage in CDK8s

```typescript
// src/cdk8s/src/resources/dns/postal-records.ts
const ZONE_ID = "your-zone-id";

// MX record for mail
new CloudflareDnsRecord(chart, "postal-mx", {
  zoneId: ZONE_ID,
  name: "@",
  type: "MX",
  content: "mail.sjer.red",
  priority: 10,
});

// SPF record
new CloudflareDnsRecord(chart, "postal-spf", {
  zoneId: ZONE_ID,
  name: "@",
  type: "TXT",
  content: "v=spf1 include:_spf.fastmail.com ip4:YOUR_IP ~all",
});

// DKIM record
new CloudflareDnsRecord(chart, "postal-dkim", {
  zoneId: ZONE_ID,
  name: "postal._domainkey",
  type: "TXT",
  content: "v=DKIM1; ...",
});
```

#### 2.3 GitHub Repository Management

```typescript
// src/cdk8s/src/constructs/github-repo.ts
export class GitHubRepository extends Construct {
  constructor(scope: Construct, id: string, props: RepoProps) {
    super(scope, id);

    new ApiObject(this, "repo", {
      apiVersion: "repo.github.upbound.io/v1alpha1",
      kind: "Repository",
      metadata: { name: id },
      spec: {
        forProvider: {
          name: props.name,
          visibility: props.visibility ?? "public",
          hasIssues: props.hasIssues ?? true,
          hasProjects: props.hasProjects ?? false,
          deleteBranchOnMerge: true,
        },
        providerConfigRef: { name: "default" },
      },
    });
  }
}
```

---

### Phase 3: Handle Services Without Crossplane Providers

For services without Crossplane providers (Postal, \*arr apps), use **K8s Jobs with TypeScript**:

#### 3.1 Base Job Construct

```typescript
// src/cdk8s/src/constructs/api-sync-job.ts
export class ApiSyncJob extends Construct {
  constructor(
    scope: Construct,
    id: string,
    props: {
      image: string;
      script: string;
      secrets: Secret[];
      schedule?: string; // cron for recurring
    },
  ) {
    super(scope, id);

    const configMap = new ConfigMap(this, "script", {
      data: { "sync.ts": props.script },
    });

    if (props.schedule) {
      new CronJob(this, "cronjob", {
        schedule: props.schedule,
        jobTemplate: this.createJobSpec(configMap, props),
      });
    } else {
      new Job(this, "job", this.createJobSpec(configMap, props));
    }
  }
}
```

#### 3.2 Postal Configuration Job

```typescript
// src/cdk8s/src/resources/postal/postal-config-job.ts
new ApiSyncJob(chart, "postal-config", {
  image: "oven/bun:latest",
  secrets: [postalApiSecret],
  script: `
    const POSTAL_URL = "https://postal.tailnet-1a49.ts.net";
    const API_KEY = Bun.env.POSTAL_API_KEY;

    // Create organization if not exists
    // Create mail server
    // Configure domains
    // Store API credentials back to 1Password
  `,
});
```

#### 3.3 Sonarr/Radarr Configuration Job

```typescript
// src/cdk8s/src/resources/media/arr-config-job.ts
new ApiSyncJob(chart, "sonarr-config", {
  image: "oven/bun:latest",
  secrets: [sonarrApiSecret],
  script: `
    const SONARR_URL = "http://sonarr.media:8989";
    const API_KEY = Bun.env.SONARR_API_KEY;

    // Configure root folders
    await fetch(\`\${SONARR_URL}/api/v3/rootfolder\`, {
      method: "POST",
      headers: { "X-Api-Key": API_KEY },
      body: JSON.stringify({ path: "/tv" }),
    });

    // Configure download client (qBittorrent)
    // Configure indexers (from Prowlarr)
  `,
});
```

---

### Phase 4: Secret Auto-Generation

#### 4.1 Generate Secrets at Synth Time

```typescript
// src/cdk8s/src/constructs/generated-secret.ts
import { randomBytes } from "crypto";

export class GeneratedSecret extends Construct {
  public readonly value: string;

  constructor(
    scope: Construct,
    id: string,
    props: {
      length?: number;
      type: "hex" | "base64" | "alphanumeric";
      onePasswordPath?: string;
    },
  ) {
    super(scope, id);

    // Generate at synth time
    this.value = randomBytes(props.length ?? 32).toString(props.type);

    // If 1Password path provided, create OnePasswordItem to store it
    // (Would require 1Password Connect write access)
  }
}
```

#### 4.2 Alternative: Job-based Generation

```typescript
// Generate secrets via Job that writes to 1Password
new ApiSyncJob(chart, "generate-secrets", {
  image: "1password/op:latest",
  script: `
    # Generate Rails secret
    RAILS_SECRET=$(openssl rand -hex 64)
    op item edit "postal-secrets" rails_secret_key=$RAILS_SECRET

    # Generate DKIM key
    DKIM_KEY=$(openssl genrsa 2048)
    op item edit "postal-secrets" signing_key="$DKIM_KEY"
  `,
});
```

---

## Files to Create

| Path                                              | Purpose                             |
| ------------------------------------------------- | ----------------------------------- |
| `src/cdk8s/src/resources/crossplane/`             | Crossplane installation + providers |
| `src/cdk8s/src/constructs/cloudflare-dns.ts`      | CloudFlare DNS record construct     |
| `src/cdk8s/src/constructs/github-repo.ts`         | GitHub repository construct         |
| `src/cdk8s/src/constructs/api-sync-job.ts`        | Base class for API sync jobs        |
| `src/cdk8s/src/resources/dns/`                    | All DNS records as code             |
| `src/cdk8s/src/resources/postal/postal-config.ts` | Postal configuration job            |
| `src/cdk8s/src/resources/media/arr-config.ts`     | Sonarr/Radarr config jobs           |

---

## Priority Order

1. **Install Crossplane** - Foundation for everything else
2. **CloudFlare DNS records** - High value, immediate use
3. **Postal configuration** - Currently manual
4. **Media stack (\*arr apps)** - Quality of life
5. **GitHub repo management** - Nice to have
6. **Secret auto-generation** - Polish

---

## Verification

1. **Crossplane health**: `kubectl get providers` - all should be `Healthy`
2. **DNS records**: `dig @1.1.1.1 mail.sjer.red` - verify records exist
3. **ArgoCD sync**: All resources should be synced and healthy
4. **External state**: Check CloudFlare dashboard, GitHub repos exist
5. **Drift detection**: Manually change a DNS record, verify Crossplane reverts it

---

## Risks & Mitigations

| Risk                               | Mitigation                             |
| ---------------------------------- | -------------------------------------- |
| Crossplane provider bugs           | Pin provider versions, test in staging |
| Rate limiting (CloudFlare/GitHub)  | Crossplane has built-in backoff        |
| Credential exposure                | 1Password operator + RBAC              |
| Provider gaps (no Postal provider) | Use HTTP provider or K8s Jobs          |
