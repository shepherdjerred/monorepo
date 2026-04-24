import * as k8s from "@kubernetes/client-node";
import { z } from "zod/v4";
import type { GolinkEntry } from "#shared/types.ts";

function getK8sClient(): k8s.NetworkingV1Api {
  const kc = new k8s.KubeConfig();
  kc.loadFromCluster();
  return kc.makeApiClient(k8s.NetworkingV1Api);
}

// golink validates an XSRF token, scoped to the target path, on every
// state-changing POST. The token is embedded in the HTML form on each page.
// Tagged-device identities get JSON responses when Sec-Golink is set, which
// strips the form, so the token fetch must use Accept: text/html and omit
// Sec-Golink. The POST itself still uses Sec-Golink to flag it as API traffic.
async function fetchXsrfToken(pageUrl: string): Promise<string> {
  const response = await fetch(pageUrl, { headers: { Accept: "text/html" } });
  if (!response.ok) {
    throw new Error(
      `Failed to fetch XSRF token from ${pageUrl}: ${String(response.status)}`,
    );
  }
  const html = await response.text();
  const match = /name="xsrf" value="([^"]*)"/.exec(html);
  if (match?.[1] === undefined || match[1] === "") {
    throw new Error(`No XSRF token in response from ${pageUrl}`);
  }
  return match[1];
}

export type GolinkSyncActivities = typeof golinkSyncActivities;

export const golinkSyncActivities = {
  async listTailscaleIngresses(): Promise<string[]> {
    const networkingApi = getK8sClient();

    const response = await networkingApi.listIngressForAllNamespaces();
    const hostnames: string[] = [];

    for (const ingress of response.items) {
      if (ingress.spec?.ingressClassName !== "tailscale") {
        continue;
      }

      const lbIngress = ingress.status?.loadBalancer?.ingress;
      if (lbIngress !== undefined && lbIngress.length > 0) {
        const hostname = lbIngress[0]?.hostname;
        if (hostname !== undefined && hostname !== "") {
          hostnames.push(hostname);
        }
      }
    }

    return [...new Set(hostnames)].toSorted();
  },

  async getExistingGolinks(golinkUrl: string): Promise<GolinkEntry[]> {
    const response = await fetch(`${golinkUrl}/.export`, {
      headers: { "Sec-Golink": "1" },
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch existing golinks: ${String(response.status)}`,
      );
    }

    const text = await response.text();
    const entries: GolinkEntry[] = [];

    for (const line of text.split("\n")) {
      if (line.trim() === "") {
        continue;
      }
      try {
        const GolinkLine = z.object({
          Short: z.string().optional(),
          Long: z.string().optional(),
        });
        const parsed = GolinkLine.parse(JSON.parse(line));
        if (parsed.Short !== undefined && parsed.Long !== undefined) {
          entries.push({ short: parsed.Short, long: parsed.Long });
        }
      } catch {
        // Skip malformed lines
      }
    }

    return entries;
  },

  async createOrUpdateGolink(
    golinkUrl: string,
    short: string,
    long: string,
  ): Promise<void> {
    const xsrfToken = await fetchXsrfToken(`${golinkUrl}/`);

    const response = await fetch(`${golinkUrl}/`, {
      method: "POST",
      headers: {
        "Sec-Golink": "1",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `short=${encodeURIComponent(short)}&long=${encodeURIComponent(long)}&xsrf=${encodeURIComponent(xsrfToken)}`,
    });

    if (!response.ok) {
      throw new Error(
        `Failed to create/update golink go/${short}: ${String(response.status)}`,
      );
    }

    console.warn(`Created/updated: go/${short} -> ${long}`);
  },

  async deleteStaleGolink(golinkUrl: string, short: string): Promise<void> {
    const xsrfToken = await fetchXsrfToken(`${golinkUrl}/.detail/${short}`);

    const deleteResponse = await fetch(`${golinkUrl}/.delete/${short}`, {
      method: "POST",
      headers: {
        "Sec-Golink": "1",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `xsrf=${encodeURIComponent(xsrfToken)}`,
    });

    if (!deleteResponse.ok) {
      throw new Error(
        `Failed to delete go/${short}: ${String(deleteResponse.status)}`,
      );
    }

    console.warn(`Deleted stale: go/${short}`);
  },
};
