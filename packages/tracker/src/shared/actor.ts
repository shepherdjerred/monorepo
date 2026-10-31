import { z } from "zod";

export const ActorMetadataSchema = z.strictObject({
  harness: z.string().max(200).optional(),
  harnessVersion: z.string().max(200).optional(),
  model: z.string().max(200).optional(),
  sessionId: z.string().max(500).optional(),
  sessionLink: z.string().max(2000).optional(),
  executable: z.string().max(2000).optional(),
  hostname: z.string().max(200).optional(),
  branch: z.string().max(1000).optional(),
  worktree: z.string().max(2000).optional(),
  repoHead: z.string().max(200).optional(),
  cwd: z.string().max(2000).optional(),
  herdrWorkspace: z.string().max(500).optional(),
  hcTerminal: z.string().max(500).optional(),
  parentKey: z.string().max(500).optional(),
  plan: z.string().max(2000).optional(),
});
export const ActorSchema = z.strictObject({
  key: z
    .string()
    .max(500)
    .regex(/^[a-z0-9][a-z0-9._-]*:\S+$/u),
  kind: z.enum(["human", "agent", "runner"]),
  name: z.string().trim().min(1).max(200),
  metadata: ActorMetadataSchema.default({}),
});
export type ActorEnvelope = z.infer<typeof ActorSchema>;
