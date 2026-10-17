import { z } from "zod";
import {
  ApiErrorSchema,
  DeploymentDetailSchema,
  DeploymentSchema,
  EnvironmentSchema,
  ImportedSnapshotSchema,
  OverviewSchema,
  PipelineRevisionSchema,
  PrincipalSchema,
  VersionSetRevisionSchema,
  diffVersionSets,
} from "./contract.ts";
import type {
  CreateDeployment,
  PublishBuild,
  ComposeVersionSet,
  PipelineDefinition,
  RegisterEnvironment,
  ImportSnapshotSchema,
} from "./contract.ts";

export class DeliveryClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DeliveryClientError";
  }
}

export function createDeliveryClient(options: {
  baseUrl: string;
  fetch?: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>;
  headers?: ConstructorParameters<typeof Headers>[0];
}) {
  const transport = options.fetch ?? fetch;
  async function request<T>(
    path: string,
    schema: z.ZodType<T>,
    body?: unknown,
  ): Promise<T> {
    const headers = new Headers(options.headers);
    headers.set("Accept", "application/json");
    if (!headers.has("Authorization") && options.baseUrl.startsWith("http"))
      headers.set("Origin", new URL(options.baseUrl).origin);
    if (body !== undefined) headers.set("Content-Type", "application/json");
    const response = await transport(
      `${options.baseUrl.replace(/\/$/, "")}/api/v1${path}`,
      {
        method: body === undefined ? "GET" : "POST",
        headers,
        credentials: "same-origin",
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
    );
    const raw: unknown = await response.json();
    if (!response.ok) {
      const error = ApiErrorSchema.safeParse(raw);
      throw new DeliveryClientError(
        response.status,
        error.success ? error.data.error.code : "HTTP_ERROR",
        error.success
          ? error.data.error.message
          : `Delivery request failed (${String(response.status)})`,
      );
    }
    return schema.parse(raw);
  }
  const version = (id: string) =>
    request(`/versions/${encodeURIComponent(id)}`, VersionSetRevisionSchema);
  return {
    identity: () => request("/identity", PrincipalSchema),
    overview: () => request("/overview", OverviewSchema),
    versions: (serviceId?: string) =>
      request(
        `/versions${serviceId === undefined ? "" : `?serviceId=${encodeURIComponent(serviceId)}`}`,
        z.array(VersionSetRevisionSchema),
      ),
    version,
    deployment: (id: string) =>
      request(`/deployments/${encodeURIComponent(id)}`, DeploymentDetailSchema),
    diff: async (fromId: string | null, toId: string) => {
      const [from, to] = await Promise.all([
        fromId === null ? null : version(fromId),
        version(toId),
      ]);
      return diffVersionSets(from, to);
    },
    createDeployment: (input: CreateDeployment) =>
      request("/deployments", DeploymentSchema, input),
    approve: (
      id: string,
      input: { decision: "approve" | "reject"; reason: string },
    ) =>
      request(
        `/deployments/${encodeURIComponent(id)}/approval`,
        DeploymentSchema,
        input,
      ),
    cancel: (id: string) =>
      request(
        `/deployments/${encodeURIComponent(id)}/cancel`,
        DeploymentSchema,
        {},
      ),
    recover: (id: string, input: { operationId: string; reason: string }) =>
      request(
        `/deployments/${encodeURIComponent(id)}/release-lock`,
        DeploymentSchema,
        input,
      ),
    retry: (
      id: string,
      input: { requestId: string; expectedGeneration: number },
    ) =>
      request(
        `/deployments/${encodeURIComponent(id)}/retry`,
        DeploymentSchema,
        input,
      ),
    publish: (input: PublishBuild) =>
      request(
        "/builds",
        z.object({ buildId: z.string(), artifacts: z.array(z.string()) }),
        input,
      ),
    compose: (input: ComposeVersionSet) =>
      request("/versions", VersionSetRevisionSchema, input),
    registerPipeline: (id: string, definition: PipelineDefinition) =>
      request("/pipelines", PipelineRevisionSchema, { id, definition }),
    registerEnvironment: (input: RegisterEnvironment) =>
      request("/environments", EnvironmentSchema, input),
    imports: () => request("/imports", z.array(ImportedSnapshotSchema)),
    importSnapshot: (input: z.infer<typeof ImportSnapshotSchema>) =>
      request("/imports", ImportedSnapshotSchema, input),
  };
}
export type DeliveryClient = ReturnType<typeof createDeliveryClient>;
