import * as k8s from "@kubernetes/client-node";
import { z } from "zod/v4";
import type { GolinkEntry } from "#shared/types.ts";

function getK8sClient(): k8s.NetworkingV1Api {
  const kc = new k8s.KubeConfig();
  kc.loadFromCluster();
  return kc.makeApiClient(k8s.NetworkingV1Api);
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
    const response = await fetch(`${golinkUrl}/`, {
      method: "POST",
      headers: {
        "Sec-Golink": "1",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `short=${encodeURIComponent(short)}&long=${encodeURIComponent(long)}`,
    });

    if (!response.ok) {
      throw new Error(
        `Failed to create/update golink go/${short}: ${String(response.status)}`,
      );
    }

    console.warn(`Created/updated: go/${short} -> ${long}`);
  },

  async deleteStaleGolink(golinkUrl: string, short: string): Promise<void> {
    // Fetch detail page to get XSRF token
    const detailResponse = await fetch(`${golinkUrl}/.detail/${short}`, {
      headers: { "Sec-Golink": "1" },
    });

    if (!detailResponse.ok) {
      console.warn(`Could not fetch detail page for go/${short}`);
      return;
    }

    const html = await detailResponse.text();
    const xsrfMatch = /name="xsrf" value="([^"]*)"/.exec(html);
    const xsrfToken = xsrfMatch?.[1];

    if (xsrfToken === undefined) {
      console.warn(`Could not find XSRF token for go/${short}`);
      return;
    }

    const deleteResponse = await fetch(`${golinkUrl}/.delete/${short}`, {
      method: "POST",
      headers: {
        "Sec-Golink": "1",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `xsrf=${encodeURIComponent(xsrfToken)}`,
    });

    if (!deleteResponse.ok) {
      console.warn(
        `Failed to delete go/${short}: ${String(deleteResponse.status)}`,
      );
      return;
    }

    console.warn(`Deleted stale: go/${short}`);
  },
};
