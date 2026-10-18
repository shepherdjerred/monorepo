import { z } from "zod";
import { run } from "@shepherdjerred/root-scripts/lib/run.ts";
import { DELIVERY_CREDENTIAL_ITEMS } from "#cdk8s/src/resources/delivery/activation.ts";
import { BootstrapApplicationSchema } from "./bootstrap-selection.ts";
import type { HandoverDescriptor } from "./delivery-handover-selection.ts";

const origin = "https://argocd.sjer.red";
type Transport = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;
type Credentials = { workload: string; platform: string };

/** Only issued, source-registered scoped credentials. No ambient operator/admin token fallback. */
export async function loadHandoverCredentials() {
  const item = z.string().regex(/^[a-z0-9]{26}$/u);
  const workload = item.parse(DELIVERY_CREDENTIAL_ITEMS.argocd);
  const platform = item.parse(DELIVERY_CREDENTIAL_ITEMS.platformArgocd);
  const read = async (id: string) => {
    const result = await run(
      [
        new URL(
          "../../../../scripts/onepassword/with-service-account.sh",
          import.meta.url,
        ).pathname,
        "op",
        "read",
        `op://v64ocnykdqju4ui6j6pua56xw4/${id}/ARGOCD_TOKEN`,
      ],
      { capture: true, echoCapturedStdout: false },
    );
    return z.string().min(1).parse(result.stdout.trim());
  };
  return {
    credentials: {
      workload: await read(workload),
      platform: await read(platform),
    },
    references: { workloadItemId: workload, platformItemId: platform },
  };
}

export function createHandoverArgo(
  credentials: Credentials,
  transport: Transport = fetch,
) {
  const request = async (
    path: string,
    role: keyof Credentials = "platform",
    patch?: unknown,
  ) => {
    const response = await transport(new URL(`/api/v1/${path}`, origin), {
      method: patch === undefined ? "GET" : "PATCH",
      headers: {
        Authorization: `Bearer ${credentials[role]}`,
        "content-type": "application/json",
      },
      ...(patch === undefined
        ? {}
        : {
            body: JSON.stringify({
              patch: JSON.stringify(patch),
              patchType: "json",
            }),
          }),
      signal: AbortSignal.timeout(30_000),
      redirect: "error",
    });
    if (!response.ok)
      throw new Error(
        `Scoped Argo ${role} request failed HTTP ${String(response.status)}; inspect retained ownership intent before repeating`,
      );
    const value: unknown = await response.json();
    return value;
  };
  const permission = async (
    role: keyof Credentials,
    action: string,
    application: string,
    expected: "yes" | "no",
  ) => {
    const result = z
      .object({ value: z.enum(["yes", "no"]) })
      .parse(
        await request(
          `account/can-i/applications/${encodeURIComponent(action)}/${encodeURIComponent(`default/${application}`)}`,
          role,
        ),
      );
    if (result.value !== expected)
      throw new Error(
        "Live scoped Argo capabilities differ from the reviewed account boundary",
      );
  };
  return {
    root: () => request("applications/apps"),
    applications: async () => {
      const result = z
        .object({ items: z.array(BootstrapApplicationSchema) })
        .parse(await request("applications"));
      if (
        new Set(result.items.map((app) => app.metadata.name)).size !==
        result.items.length
      )
        throw new Error("Duplicate native Application inventory");
      return result.items.toSorted((a, b) =>
        a.metadata.name.localeCompare(b.metadata.name),
      );
    },
    patch: async (application: string, patch: unknown) =>
      BootstrapApplicationSchema.parse(
        await request(
          `applications/${encodeURIComponent(application)}`,
          application === "delivery-control-plane" ? "platform" : "workload",
          patch,
        ),
      ),
    access: async (descriptor: HandoverDescriptor) => {
      for (const [role, username] of [
        ["workload", "delivery"],
        ["platform", "delivery-platform"],
      ] as const)
        z.object({
          loggedIn: z.literal(true),
          username: z.literal(username),
        }).parse(await request("session/userinfo", role));
      await permission("workload", "update", "apps", "no");
      await permission("workload", "update", "delivery-control-plane", "no");
      await permission("platform", "update", "arcade", "no");
      await permission("platform", "get", "apps", "yes");
      if (
        descriptor.targets.some(
          (target) => target.application === "delivery-control-plane",
        )
      ) {
        const action =
          "update/apps/Deployment/temporal/temporal-delivery-worker";
        await permission("platform", action, "delivery-control-plane", "yes");
        await permission("workload", action, "delivery-control-plane", "no");
        for (const deniedAction of [
          "update/apps/Deployment/temporal/temporal-delivery-platform-worker",
          "update//Pod/temporal/temporal-delivery-worker",
        ])
          await permission(
            "platform",
            deniedAction,
            "delivery-control-plane",
            "no",
          );
      }
      for (const target of descriptor.targets)
        await permission(
          target.application === "delivery-control-plane"
            ? "platform"
            : "workload",
          "update",
          target.application,
          "yes",
        );
      return {
        principals: ["delivery", "delivery-platform"],
        verifiedAt: new Date().toISOString(),
      };
    },
  };
}
