import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import {
  endpoint,
  IntegrationError,
  json,
  request,
  type FetchTransport,
} from "./http.ts";

const connection = z.object({
  baseUrl: z.url().refine((value) => {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === ""
    );
  }),
  token: z.string().min(1).max(16_384),
});
const profileId = z.string().regex(/^prof_[a-f\d]{8}$/u);
export const SubtitleBrowserCredentialSchema = z.union([
  connection.extend({ instanceId: z.string().min(1).max(16_384) }).strict(),
  connection.extend({ profileId }).strict(),
]);
export type SubtitleBrowserCredential = z.infer<
  typeof SubtitleBrowserCredentialSchema
>;

const Service = "subtitle-browser";
const InstanceList = z.array(
  z.object({
    id: z.string().min(1),
    profileId: z.string(),
    status: z.string(),
    attached: z.boolean(),
  }),
);
const Profile = z.object({ id: profileId });
const StartedInstance = z.object({ id: z.string().min(1), profileId });

type Instance = z.infer<typeof InstanceList>[number];
type StartReceipt = { expectedId?: string; uncertainStart?: IntegrationError };
type ProfileRequest = (
  path: string,
  body?: Record<string, unknown>,
) => Promise<unknown>;

async function startProfile(
  configuredId: string,
  call: ProfileRequest,
): Promise<StartReceipt> {
  // The start route also resolves profile names, so verify the stored ID first.
  const path = `profiles/${encodeURIComponent(configuredId)}`;
  const configured = Profile.safeParse(await call(path));
  if (!configured.success || configured.data.id !== configuredId)
    throw new IntegrationError(Service, "invalid-response");
  try {
    const started = StartedInstance.safeParse(
      await call(`${path}/start`, {
        headless: true,
        securityPolicy: { allowedDomains: ["subhd.tv", "www.subhd.tv"] },
      }),
    );
    if (!started.success || started.data.profileId !== configuredId)
      throw new IntegrationError(Service, "invalid-response");
    return { expectedId: started.data.id };
  } catch (error) {
    if (
      !(error instanceof IntegrationError) ||
      error.kind !== "outcome-unknown"
    )
      throw error;
    if (error.status === 404)
      throw new IntegrationError(Service, "unavailable", 404);
    return { uncertainStart: error };
  }
}

async function waitForRunningInstance(
  findInstance: () => Promise<Instance | undefined>,
  receipt: StartReceipt,
  signal: AbortSignal,
): Promise<string> {
  let expectedId = receipt.expectedId;
  const { uncertainStart } = receipt;
  for (;;) {
    const instance = await findInstance().catch((error: unknown) => {
      if (
        uncertainStart !== undefined &&
        error instanceof IntegrationError &&
        error.kind === "unavailable"
      )
        throw uncertainStart;
      throw error;
    });
    if (instance === undefined)
      throw uncertainStart ?? new IntegrationError(Service, "unavailable");
    if (expectedId !== undefined && instance.id !== expectedId)
      throw new IntegrationError(Service, "conflict");
    if (instance.status === "running") return instance.id;
    if (instance.status !== "starting")
      throw new IntegrationError(Service, "unavailable");
    expectedId = instance.id;
    try {
      await delay(500, undefined, { signal });
    } catch {
      throw new IntegrationError(Service, "unavailable");
    }
  }
}

/** Reuse only an exact profile match. A start request is never repeated after an uncertain response. */
export async function resolveSubtitleBrowserInstance(
  credential: SubtitleBrowserCredential,
  transport: FetchTransport,
  signal?: AbortSignal,
): Promise<string> {
  if ("instanceId" in credential) return credential.instanceId;
  const deadline = AbortSignal.timeout(30_000);
  const startupSignal =
    signal === undefined ? deadline : AbortSignal.any([signal, deadline]);
  const headers = { Authorization: `Bearer ${credential.token}` };
  const call: ProfileRequest = async (path, body) => {
    const response = await request(
      transport,
      Service,
      endpoint(credential.baseUrl, path),
      body === undefined
        ? { method: "GET", headers, signal: startupSignal }
        : {
            method: "POST",
            headers: { ...headers, "Content-Type": "application/json" },
            body: JSON.stringify(body),
            mutation: true,
            signal: startupSignal,
          },
    );
    return await json(response, Service);
  };
  const findInstance = async () => {
    const instances = InstanceList.safeParse(await call("instances"));
    if (!instances.success)
      throw new IntegrationError(Service, "invalid-response");
    const matches = instances.data.filter(
      (instance) => instance.profileId === credential.profileId,
    );
    if (matches.length > 1) throw new IntegrationError(Service, "conflict");
    if (matches[0]?.attached === true)
      throw new IntegrationError(Service, "conflict");
    return matches[0];
  };
  const initial = await findInstance();
  if (initial?.status === "running") return initial.id;
  if (initial !== undefined && initial.status !== "starting")
    throw new IntegrationError(Service, "unavailable");
  const receipt =
    initial === undefined
      ? await startProfile(credential.profileId, call)
      : { expectedId: initial.id };
  return await waitForRunningInstance(findInstance, receipt, startupSignal);
}
