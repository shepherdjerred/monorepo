import nodePath from "node:path";
import { z } from "zod";
import type { ActorEnvelope } from "@shepherdjerred/tracker/contract";
import type { TrackerClient } from "./client.ts";

const UploadedSchema = z.object({
  id: z.string(),
  filename: z.string(),
  url: z.string(),
});

export type UploadedAttachment = z.infer<typeof UploadedSchema>;

export async function uploadAttachments(
  url: string,
  files: readonly string[],
  actor: ActorEnvelope,
): Promise<UploadedAttachment[]> {
  const baseUrl = url.replace(/\/$/u, "");
  const uploaded: UploadedAttachment[] = [];
  for (const path of files) {
    const file = Bun.file(path);
    if (!(await file.exists())) throw new Error(`File does not exist: ${path}`);
    const form = new FormData();
    form.set("file", file, nodePath.basename(path));
    const response = await fetch(`${baseUrl}/api/attachments`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(120_000),
      headers: {
        "X-Tracker-Actor": Buffer.from(JSON.stringify(actor)).toString(
          "base64",
        ),
      },
    });
    if (!response.ok)
      throw new Error(
        `Tracker upload failed (HTTP ${String(response.status)})`,
      );
    uploaded.push(UploadedSchema.parse(await response.json()));
  }
  return uploaded;
}

export async function attachFiles(
  connection: { url: string; client: TrackerClient },
  identifier: string,
  files: string[],
  actor: ActorEnvelope,
) {
  const { url, client } = connection;
  if (files.length === 0) throw new Error("Provide at least one file");
  const issue = await client.issues.byIdentifier.query({ identifier });
  const uploaded = await uploadAttachments(url, files, actor);
  await client.issues.update.mutate({
    actor,
    identifier,
    expectedRevision: issue.revision,
    attachmentIds: uploaded.map((item) => item.id),
  });
  return uploaded;
}
