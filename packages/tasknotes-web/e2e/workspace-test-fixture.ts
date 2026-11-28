import { expect, type APIRequestContext } from "@playwright/test";
import type { QueuedCommand } from "@shepherdjerred/facet-protocol";
import { z } from "zod";
import { accessHeaders } from "./fixture-access.ts";

const ResponseSchema = z.object({
  temp_id_mapping: z.record(z.string(), z.string()),
  tasks: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      section_id: z.string().optional(),
      due_date: z.string().optional(),
      comments: z
        .array(z.object({ id: z.string(), file_name: z.string().optional() }))
        .optional(),
    }),
  ),
});

export async function syncResponseFor(
  request: APIRequestContext,
  commands: QueuedCommand[],
) {
  const response = await request.post("/api/v1/sync", {
    headers: accessHeaders,
    data: { commands },
  });
  await expect(response).toBeOK();
  return ResponseSchema.parse(await response.json());
}
