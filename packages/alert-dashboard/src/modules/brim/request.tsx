import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";

import { brimQuery } from "./api.ts";
import {
  BrimPage,
  BrimQueryState,
  BrimSection,
  dateLabel,
  quantity,
} from "./presentation.tsx";
import { HistoryCaptureDetailSchema, type CaptureBlock } from "./schema.ts";

function RawPayload({
  label,
  payload,
}: {
  readonly label: string;
  readonly payload: unknown;
}) {
  if (payload == null) return null;
  return (
    <details className="brim-payload">
      <summary>{label}</summary>
      <pre>
        {typeof payload === "string"
          ? payload
          : JSON.stringify(payload, null, 2)}
      </pre>
    </details>
  );
}

function Blocks({ blocks }: { readonly blocks: readonly CaptureBlock[] }) {
  if (blocks.length === 0) return <p className="brim-message">No blocks.</p>;
  return (
    <ul className="brim-messages brim-blocks" role="list">
      {blocks.map((block) => (
        <li key={`${block.section}-${String(block.index)}-${block.hash}`}>
          <RawPayload
            label={[
              `${block.section} ${String(block.index + 1)}`,
              block.role,
              block.isNew ? "New" : null,
              block.inherited ? "Inherited" : null,
            ]
              .filter((item) => item !== null)
              .join(" · ")}
            payload={block.parts}
          />
        </li>
      ))}
    </ul>
  );
}

function CapturedResponse({
  data,
}: {
  readonly data: z.infer<typeof HistoryCaptureDetailSchema>;
}) {
  const response = data.response;
  return (
    <BrimSection title="Response">
      {response === null ? (
        <p className="brim-message">No response was captured.</p>
      ) : (
        <>
          {response.stopReason === null ? null : (
            <p className="brim-message">Stop reason {response.stopReason}</p>
          )}
          <RawPayload label="Response text" payload={response.text || null} />
          <RawPayload label="Reasoning" payload={response.reasoning || null} />
          {response.toolCalls.length === 0 ? null : (
            <RawPayload label="Tool calls" payload={response.toolCalls} />
          )}
        </>
      )}
      <RawPayload label="Raw response" payload={data.rawResponse} />
    </BrimSection>
  );
}

function RequestView({
  sessionId,
  captureId,
}: {
  readonly sessionId: string;
  readonly captureId: string;
}) {
  const query = useQuery(
    brimQuery(`history/captures/${captureId}`, HistoryCaptureDetailSchema),
  );
  const data = query.data;
  const previous = data?.capture.previousCaptureId;
  return (
    <BrimPage title="Captured request">
      <div className="brim-back">
        <Link to={`/brim/sessions/${sessionId}`}>Back to session</Link>
      </div>
      {data === undefined ? (
        <BrimQueryState label="captured request" error={query.error} />
      ) : (
        <>
          <div className="brim-source">
            <strong>{data.capture.model ?? data.capture.cli}</strong>
            <span>{dateLabel(data.capture.startedAt)}</span>
            <span>{data.capture.warmup ? "Warm-up" : data.capture.status}</span>
            <span>{quantity(data.capture.blockCount)} blocks</span>
            {data.capture.contextComplete ? null : (
              <span>Some parent context is unavailable</span>
            )}
          </div>
          <BrimSection
            title="What changed"
            aside={
              previous == null ? null : (
                <Link
                  to={`/brim/sessions/${sessionId}/requests/${String(previous)}`}
                >
                  Previous request
                </Link>
              )
            }
          >
            <Blocks blocks={data.newBlocks} />
          </BrimSection>
          <BrimSection title="Reconstructed context">
            <details className="brim-payload">
              <summary>System instructions</summary>
              <Blocks blocks={data.request.system} />
            </details>
            <details className="brim-payload">
              <summary>Tool definitions</summary>
              <Blocks blocks={data.request.tools} />
            </details>
            <details className="brim-payload">
              <summary>Messages</summary>
              <Blocks blocks={data.request.messages} />
            </details>
          </BrimSection>
          <CapturedResponse data={data} />
          <BrimSection title="Wire payload">
            {data.rawRequest == null && data.fields === null ? (
              <p className="brim-message">No raw request was captured.</p>
            ) : null}
            <RawPayload label="Raw request" payload={data.rawRequest} />
            <RawPayload label="Decoded fields" payload={data.fields} />
          </BrimSection>
        </>
      )}
    </BrimPage>
  );
}

export function BrimRequestPage() {
  const { sessionId, captureId } = useParams();
  if (
    sessionId === undefined ||
    captureId === undefined ||
    !/^[1-9]\d*$/u.test(sessionId) ||
    !/^[1-9]\d*$/u.test(captureId)
  ) {
    return (
      <BrimPage title="Captured request">
        <p className="brim-message">Invalid request identifier.</p>
      </BrimPage>
    );
  }
  return <RequestView sessionId={sessionId} captureId={captureId} />;
}
import type { z } from "zod";
