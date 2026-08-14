/**
 * Recorded ArgoCD API error contract.
 *
 * `liveResourceState` treated "this resource is not in the Application's live
 * tree" as HTTP 404, because that is what a REST API is expected to answer.
 * ArgoCD fails the lookup with `codes.InvalidArgument`, which its gRPC gateway
 * renders as HTTP 400, so the branch written for exactly that case never ran
 * and every main build died in `argocd-sync` until it was fixed.
 *
 * No unit test could have caught it: the fakes encoded the same belief the code
 * did, so they agreed with each other and both were wrong. This file exists so
 * the oracle is a recording of what the server actually answered rather than
 * what anyone believed it would. `snapshot-argocd-api-contract.ts` produces the
 * recording; the offline tests replay it through the real script.
 *
 * Deliberately scoped to the *error* contract. A 200 is recorded as a status
 * only, with no body — the success shape is not what bit us, and embedding a
 * live manifest here would churn the fixture and drag cluster detail into the
 * repository for no diagnostic gain.
 */

import path from "node:path";
import { z } from "zod";

export const ARGOCD_API_CONTRACT_PATH = path.join(
  import.meta.dir,
  "..",
  "argocd-api-contract.json",
);

/**
 * How `liveResourceState` must classify the response.
 *
 * `absent` — no live object, so the resource is a creation and needs no
 * immutable-field check. `present` — a live object to compare against.
 * `error` — must fail loudly; nothing here may be quietly treated as absent.
 */
export const ContractExpectationSchema = z.enum(["absent", "present", "error"]);

/**
 * Which endpoint the probe hit. `resource` reaches `liveResourceState`;
 * `application` reaches `getApplication`, whose not-found behavior differs —
 * it answers 404 only when a `project` narrows the RBAC lookup, and 403
 * otherwise.
 */
export const ContractEndpointSchema = z.enum(["resource", "application"]);

export const ContractCaseSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  endpoint: ContractEndpointSchema,
  request: z.object({
    application: z.string().min(1),
    query: z.record(z.string(), z.string()),
  }),
  response: z.object({
    status: z.number().int(),
    body: z.unknown().optional(),
  }),
  expect: ContractExpectationSchema,
});

export const ArgocdApiContractSchema = z.object({
  generatedAt: z.iso.datetime(),
  server: z.string().min(1),
  argocdVersion: z.string().min(1),
  cases: z.array(ContractCaseSchema).min(1),
});

export type ArgocdApiContract = z.infer<typeof ArgocdApiContractSchema>;
export type ArgocdApiContractCase = z.infer<typeof ContractCaseSchema>;

export async function readArgocdApiContract(): Promise<ArgocdApiContract> {
  const file = Bun.file(ARGOCD_API_CONTRACT_PATH);
  if (!(await file.exists())) {
    throw new Error(
      `Missing ${ARGOCD_API_CONTRACT_PATH}. Record it with ` +
        `bun run argocd:contract (needs ARGOCD_TOKEN).`,
    );
  }
  return ArgocdApiContractSchema.parse(await file.json());
}

/**
 * The message ArgoCD builds for a resource outside an Application's tree:
 * `fmt.Sprintf("%s %s %s not found as part of application %s", kind, group,
 * name, app)`. A core-group resource has an empty group, which leaves a double
 * space — the detail a hand-written fake gets wrong, and the reason this is
 * derived here rather than retyped per test.
 */
export function resourceOutsideApplicationMessage(
  contractCase: ArgocdApiContractCase,
): string {
  const { application, query } = contractCase.request;
  const kind = query["kind"] ?? "";
  const group = query["group"] ?? "";
  const name = query["resourceName"] ?? "";
  return `${kind} ${group} ${name} not found as part of application ${application}`;
}
