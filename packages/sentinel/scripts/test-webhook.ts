import { createHmac } from "node:crypto";
import { z } from "zod";

const OP_ITEM_ID = "xjneyr3nt56u5li4anhbglnbr4";

const PROVIDERS = {
  github: {
    opField: "github-webhook-secret",
    envVar: "GITHUB_WEBHOOK_SECRET",
  },
  pagerduty: {
    opField: "pagerduty-webhook-secret",
    envVar: "PAGERDUTY_WEBHOOK_SECRET",
  },
  buildkite: {
    opField: "buildkite-webhook-token",
    envVar: "BUILDKITE_WEBHOOK_TOKEN",
  },
  bugsink: {
    opField: "bugsink-webhook-secret",
    envVar: "BUGSINK_WEBHOOK_SECRET",
  },
} as const;

type Provider = keyof typeof PROVIDERS;

function getSecret(provider: Provider): string {
  const config = PROVIDERS[provider];

  const result = Bun.spawnSync(["op", "item", "get", OP_ITEM_ID, "--fields", config.opField]);
  if (result.exitCode === 0) {
    const value = result.stdout.toString().trim();
    if (value.length > 0) {
      console.log(`Using secret from 1Password for ${provider}`);
      return value;
    }
  }

  const envValue = Bun.env[config.envVar];
  if (envValue != null && envValue.length > 0) {
    console.log(`Using secret from env var ${config.envVar} for ${provider}`);
    return envValue;
  }

  console.error(`No secret found for ${provider}. Set ${config.envVar} or install 1Password CLI.`);
  process.exit(1);
}

function makeGitHubPayload(): Record<string, unknown> {
  return {
    action: "completed",
    workflow_run: {
      id: 12_345_678,
      name: "CI",
      head_branch: "main",
      conclusion: "failure",
      html_url: "https://github.com/shepherdjerred/monorepo/actions/runs/12345678",
      repository: {
        full_name: "shepherdjerred/monorepo",
      },
    },
    repository: {
      full_name: "shepherdjerred/monorepo",
    },
  };
}

function makePagerDutyPayload(): Record<string, unknown> {
  return {
    event: {
      id: "test-event-001",
      event_type: "incident.triggered",
      data: {
        id: "P123ABC",
        title: "High CPU usage on production web server",
        urgency: "high",
        html_url: "https://example.pagerduty.com/incidents/P123ABC",
        service: {
          summary: "Production Web App",
        },
      },
    },
  };
}

function makeBuildkitePayload(): Record<string, unknown> {
  return {
    event: "build.finished",
    build: {
      id: "test-build-001",
      state: "failed",
      branch: "main",
      message: "fix: update broken config",
      web_url: "https://buildkite.com/shepherdjerred/monorepo/builds/123",
    },
    pipeline: {
      name: "monorepo",
    },
  };
}

function makeBugsinkPayload(): Record<string, unknown> {
  return {
    title: "TypeError: Cannot read properties of undefined (reading 'map')",
    project: "sentinel",
    url: "https://bugsink.example.com/issues/12345",
    count: 3,
    first_seen: new Date().toISOString(),
  };
}

async function sendWebhook(provider: Provider, baseUrl: string): Promise<void> {
  const secret = getSecret(provider);

  let url: string;
  let body: string;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  switch (provider) {
    case "github": {
      url = `${baseUrl}/webhook/github`;
      body = JSON.stringify(makeGitHubPayload());
      const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
      headers["X-Hub-Signature-256"] = signature;
      headers["X-GitHub-Event"] = "workflow_run";
      headers["X-GitHub-Delivery"] = crypto.randomUUID();
      break;
    }
    case "pagerduty": {
      url = `${baseUrl}/webhook/pagerduty`;
      body = JSON.stringify(makePagerDutyPayload());
      const signature = `v1=${createHmac("sha256", secret).update(body).digest("hex")}`;
      headers["X-PagerDuty-Signature"] = signature;
      break;
    }
    case "buildkite": {
      url = `${baseUrl}/webhook/buildkite`;
      body = JSON.stringify(makeBuildkitePayload());
      headers["X-Buildkite-Token"] = secret;
      headers["X-Buildkite-Event"] = "build.finished";
      break;
    }
    case "bugsink": {
      url = `${baseUrl}/webhook/bugsink/${secret}`;
      body = JSON.stringify(makeBugsinkPayload());
      break;
    }
  }

  console.log(`Sending ${provider} webhook to ${url}`);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body,
    });
    const responseBody = await response.text();
    console.log(`Response status: ${String(response.status)}`);
    console.log(`Response body: ${responseBody}`);

    if (!response.ok) {
      process.exit(1);
    }
  } catch (error: unknown) {
    console.error(`Failed to send webhook:`, error);
    process.exit(1);
  }
}

const ProviderSchema = z.enum(["github", "pagerduty", "buildkite", "bugsink"]);
const baseUrl = Bun.argv[3] ?? "http://localhost:3000";

const parsed = ProviderSchema.safeParse(Bun.argv[2]);

if (!parsed.success) {
  console.error(`Usage: bun run scripts/test-webhook.ts <provider> [url]`);
  console.error(`  provider: github | pagerduty | buildkite | bugsink`);
  console.error(`  url: defaults to http://localhost:3000`);
  process.exit(1);
}

await sendWebhook(parsed.data, baseUrl);
