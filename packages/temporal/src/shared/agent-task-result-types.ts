import type {
  AgentTaskProvider,
  AgentTaskResultPayload,
  AgentTaskResultPayloadV2,
} from "#shared/agent-task.ts";
import type { ReportEvidenceReceiptV1 } from "#shared/report.ts";

/**
 * The shape an agent-task run resolves to.
 *
 * Declared here rather than in the activity that produces it: the activity's
 * own side-activity helpers consume the type, so keeping it next to the
 * producer made the two modules import each other. Everything it is built from
 * already lives in the shared layer.
 */
type RunAgentTaskResultBase = {
  provider: AgentTaskProvider;
  model: string;
  durationMs: number;
  startedAt: string;
  evidence: ReportEvidenceReceiptV1[];
};

export type RunAgentTaskResultV2 = RunAgentTaskResultBase & {
  contractVersion: 2;
  payload: AgentTaskResultPayloadV2;
};

export type RunAgentTaskResult = RunAgentTaskResultBase &
  (
    | ({
        contractVersion: 1;
        payload: AgentTaskResultPayload;
      } & AgentTaskResultPayload)
    | RunAgentTaskResultV2
  );
