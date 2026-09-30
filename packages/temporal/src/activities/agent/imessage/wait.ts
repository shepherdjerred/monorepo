import { createTemporalClient } from "#client";

export async function waitForImessageCommand(
  workflowId: string,
): Promise<void> {
  const temporal = await createTemporalClient();
  await temporal.workflow.getHandle(workflowId).result();
}
