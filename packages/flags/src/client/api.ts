import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { FlagValue } from "@shepherdjerred/feature-flags/evaluate.ts";
import { FlagValueSchema } from "@shepherdjerred/flags/schema.ts";

const DeploymentSummarySchema = z.strictObject({
  id: z.string(),
  revision: z.number().int(),
  flagCount: z.number().int(),
});

const DocumentSchema = z.strictObject({
  id: z.string(),
  revision: z.number().int(),
  flags: z.array(FlagValueSchema),
});

const ConflictSchema = z.strictObject({
  error: z.string(),
  revision: z.number().int(),
  flags: z.array(FlagValueSchema),
});

export type DeploymentDocument = z.infer<typeof DocumentSchema>;

export type ApplyResult =
  | { readonly kind: "saved"; readonly revision: number }
  | {
      readonly kind: "conflict";
      readonly revision: number;
      readonly flags: readonly FlagValue[];
    };

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  return text.length === 0 ? undefined : (JSON.parse(text) as unknown);
}

const ErrorBodySchema = z.object({ error: z.string() });

function errorMessage(body: unknown, status: number): string {
  const parsed = ErrorBodySchema.safeParse(body);
  return parsed.success
    ? parsed.data.error
    : `Request failed (${String(status)})`;
}

async function getJson<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  const response = await fetch(path);
  const body = await readJson(response);
  if (!response.ok) throw new Error(errorMessage(body, response.status));
  return schema.parse(body);
}

export function useDeployments() {
  return useQuery({
    queryKey: ["deployments"],
    queryFn: async () => {
      const body = await getJson(
        "/v1/deployments",
        z.strictObject({ deployments: z.array(DeploymentSummarySchema) }),
      );
      return body.deployments;
    },
  });
}

export function useDocument(catalog: string, stage: string) {
  return useQuery({
    queryKey: ["document", catalog, stage],
    queryFn: () =>
      getJson(
        `/v1/deployments/${encodeURIComponent(catalog)}/${encodeURIComponent(stage)}`,
        DocumentSchema,
      ),
  });
}

export function useApplyFlag(catalog: string, stage: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      readonly expectedRevision: number;
      readonly flag: FlagValue;
    }): Promise<ApplyResult> => {
      const response = await fetch(
        `/v1/deployments/${encodeURIComponent(catalog)}/${encodeURIComponent(stage)}/apply`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            expectedRevision: input.expectedRevision,
            flags: [input.flag],
          }),
        },
      );
      const body = await readJson(response);
      if (response.status === 409) {
        const conflict = ConflictSchema.parse(body);
        return {
          kind: "conflict",
          revision: conflict.revision,
          flags: conflict.flags,
        };
      }
      if (!response.ok) throw new Error(errorMessage(body, response.status));
      const saved = z.strictObject({ revision: z.number().int() }).parse(body);
      return { kind: "saved", revision: saved.revision };
    },
    onSuccess: (result) => {
      if (result.kind !== "saved") return;
      void queryClient.invalidateQueries({
        queryKey: ["document", catalog, stage],
      });
    },
  });
}
