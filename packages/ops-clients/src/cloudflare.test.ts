import { describe, expect, test } from "vitest";
import {
  CloudflareClient,
  lookupRdapExpiryDays,
} from "@shepherdjerred/ops-clients/cloudflare.ts";
import {
  fakeFetch,
  sequence,
} from "@shepherdjerred/ops-clients/test-support/fake-fetch.ts";

describe("CloudflareClient zones and R2", () => {
  test("lists zones and evaluates DNSSEC + SPF/DMARC/MX/MTA-STS baseline", async () => {
    const { fetch, requests } = sequence(
      {
        success: true,
        result_info: { page: 1, total_pages: 1 },
        result: [
          {
            id: "z1",
            name: "sjer.red",
            status: "active",
            paused: false,
            plan: { name: "Free Website" },
            name_servers: ["ns1.cloudflare.com"],
          },
        ],
      },
      {
        success: true,
        result: { status: "active" },
      },
      {
        success: true,
        result_info: { page: 1, total_pages: 1 },
        result: [
          {
            id: "r1",
            type: "TXT",
            name: "sjer.red",
            content: '"v=spf1 include:_spf.mx.cloudflare.net -all"',
          },
          {
            id: "r2",
            type: "TXT",
            name: "_dmarc.sjer.red",
            content: "v=DMARC1; p=reject;",
          },
          {
            id: "r3",
            type: "MX",
            name: "sjer.red",
            content: "route1.mx.cloudflare.net",
          },
          {
            id: "r4",
            type: "TXT",
            name: "_mta-sts.sjer.red",
            content: "v=STSv1; id=20260924",
          },
        ],
      },
    );

    const client = new CloudflareClient({
      apiToken: "cf-token",
      accountId: "acc-1",
      fetch,
    });

    const zones = await client.listZones();
    expect(zones).toEqual([
      {
        id: "z1",
        name: "sjer.red",
        status: "active",
        paused: false,
        plan: "Free Website",
        nameServers: ["ns1.cloudflare.com"],
      },
    ]);
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer cf-token");

    const baseline = await client.evaluateZoneDnsBaseline("z1", "sjer.red");
    expect(baseline).toEqual({
      zoneId: "z1",
      zoneName: "sjer.red",
      dnssecStatus: "active",
      dnssecEnabled: true,
      hasSpf: true,
      hasDmarc: true,
      hasMx: true,
      hasMtaSts: true,
      spfRecord: "v=spf1 include:_spf.mx.cloudflare.net -all",
      dmarcRecord: "v=DMARC1; p=reject;",
      mxRecords: ["route1.mx.cloudflare.net"],
      mtaStsRecord: "v=STSv1; id=20260924",
    });
  });

  test("enriches R2 buckets from GraphQL and falls back gracefully on permission error", async () => {
    const withGraphql = sequence(
      {
        success: true,
        result: {
          buckets: [
            {
              name: "homelab-backups",
              creation_date: "2025-01-01T00:00:00Z",
              location: "WNAM",
            },
            { name: "empty-bucket" },
          ],
        },
      },
      {
        data: {
          viewer: {
            accounts: [
              {
                r2StorageAdaptiveGroups: [
                  {
                    dimensions: { bucketName: "homelab-backups" },
                    max: {
                      payloadSize: 1000,
                      metadataSize: 24,
                      objectCount: 15,
                    },
                  },
                ],
              },
            ],
          },
        },
      },
    );

    const client = new CloudflareClient({
      apiToken: "cf-token",
      fetch: withGraphql.fetch,
    });
    await expect(client.listR2Buckets("acc-1")).resolves.toEqual([
      {
        name: "homelab-backups",
        createdAt: "2025-01-01T00:00:00Z",
        location: "WNAM",
        payloadBytes: 1024,
        objectCount: 15,
      },
      {
        name: "empty-bucket",
        createdAt: undefined,
        location: undefined,
        payloadBytes: 0,
        objectCount: 0,
      },
    ]);

    const deniedGraphql = fakeFetch((req) => {
      if (req.url.endsWith("/graphql")) {
        return new Response("forbidden", { status: 403 });
      }
      return Response.json({
        success: true,
        result: { buckets: [{ name: "homelab-backups" }] },
      });
    });
    const fallbackClient = new CloudflareClient({
      apiToken: "cf-token",
      accountId: "acc-1",
      fetch: deniedGraphql.fetch,
    });
    await expect(fallbackClient.listR2Buckets()).resolves.toEqual([
      {
        name: "homelab-backups",
        createdAt: undefined,
        location: undefined,
        payloadBytes: null,
        objectCount: null,
      },
    ]);
  });
});

describe("CloudflareClient tunnels and RDAP", () => {
  test("lists tunnel ingress routes and preserves locally-managed tunnels", async () => {
    const { fetch } = sequence(
      {
        success: true,
        result_info: { page: 1, total_pages: 1 },
        result: [
          {
            id: "t-remote",
            name: "edge-tunnel",
            status: "healthy",
            connections: [{ colo_name: "SJC" }, { colo_name: "LAX" }],
          },
          {
            id: "t-local",
            name: "homelab-tunnel",
            status: "healthy",
            connections: [{ colo_name: "SEA" }],
          },
        ],
      },
      {
        success: true,
        result: {
          config: {
            ingress: [
              { hostname: "sjer.red", service: "http://caddy:80" },
              { service: "http_status:404" },
            ],
          },
        },
      },
      {
        success: true,
        result: { config: null },
      },
    );

    const client = new CloudflareClient({
      apiToken: "cf-token",
      accountId: "acc-1",
      fetch,
    });
    await expect(client.listTunnelRoutes()).resolves.toEqual([
      {
        tunnelId: "t-remote",
        tunnelName: "edge-tunnel",
        tunnelStatus: "healthy",
        activeConnections: 2,
        hostname: "sjer.red",
        path: undefined,
        service: "http://caddy:80",
      },
      {
        tunnelId: "t-local",
        tunnelName: "homelab-tunnel",
        tunnelStatus: "healthy",
        activeConnections: 1,
        hostname: undefined,
        path: undefined,
        service: "(tunnel)",
      },
    ]);
  });

  test("computes RDAP days until expiration and returns null on missing/404", async () => {
    const now = new Date("2026-09-24T00:00:00Z");
    const ok = sequence({
      events: [
        { eventAction: "registration", eventDate: "2020-10-24T00:00:00Z" },
        { eventAction: "expiration", eventDate: "2026-10-24T12:00:00Z" },
      ],
    });
    await expect(lookupRdapExpiryDays("sjer.red", ok.fetch, now)).resolves.toBe(
      30,
    );
    expect(ok.requests[0]?.url).toBe("https://rdap.org/domain/sjer.red");

    const notFound = fakeFetch(
      () => new Response("not found", { status: 404 }),
    );
    await expect(
      lookupRdapExpiryDays("unsupported.invalid", notFound.fetch, now),
    ).resolves.toBeNull();
  });
});
