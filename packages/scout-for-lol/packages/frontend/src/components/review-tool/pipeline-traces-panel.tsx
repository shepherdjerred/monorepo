/**
 * Pipeline traces display components for debugging AI review pipeline
 *
 * Shows detailed information about each stage's request/response for debugging.
 */
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card.tsx";
import type {
  PipelineTraces,
  PipelineIntermediateResults,
  StageTrace,
  TimelineChunkTrace,
} from "@scout-for-lol/frontend/lib/review-tool/config/schema";

type CollapsibleSectionProps = {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
  badge?: string;
};

function CollapsibleSection({
  title,
  defaultOpen = false,
  children,
  badge,
}: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="rounded-md border border-surface-200 overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center justify-between px-3 py-2 bg-surface-50 hover:bg-surface-100 text-left"
        onClick={() => {
          setIsOpen(!isOpen);
        }}
      >
        <div className="flex items-center gap-2">
          <svg
            className={`w-4 h-4 transition-transform ${isOpen ? "rotate-90" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5l7 7-7 7"
            />
          </svg>
          <span className="text-xs font-semibold text-surface-700">
            {title}
          </span>
        </div>
        {badge && <span className="text-xs text-surface-500">{badge}</span>}
      </button>
      {isOpen && <div className="p-2">{children}</div>}
    </div>
  );
}

type TraceCardProps = {
  label: string;
  trace: StageTrace | undefined;
  text: string | undefined;
};

function TraceCard({ label, trace, text }: TraceCardProps) {
  if (!trace && !text) {
    return null;
  }

  const systemPrompt = trace?.request.systemPrompt;
  const userPrompt = trace?.request.userPrompt;
  const responseText = trace?.response.text ?? text;

  const systemPromptLength = systemPrompt?.length ?? 0;
  const userPromptLength = userPrompt?.length ?? 0;
  const responseLength = responseText?.length ?? 0;

  return (
    <Card>
      <CardHeader className="flex items-start justify-between">
        <CardTitle>{label}</CardTitle>
        {trace && (
          <div className="text-xs text-surface-600 text-right space-y-0.5">
            <div>{trace.model.model}</div>
            <div className="flex items-center gap-2">
              <span>{trace.durationMs}ms</span>
              {trace.tokensPrompt !== undefined && (
                <span className="text-surface-500">
                  {trace.tokensPrompt.toLocaleString()} input tokens
                </span>
              )}
              {trace.tokensCompletion !== undefined && (
                <span className="text-surface-500">
                  {trace.tokensCompletion.toLocaleString()} output tokens
                </span>
              )}
            </div>
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {systemPrompt && (
          <CollapsibleSection
            title="System prompt"
            badge={`${systemPromptLength.toLocaleString()} chars`}
          >
            <pre className="whitespace-pre-wrap rounded-md bg-surface-50 p-2 text-xs text-surface-800 max-h-64 overflow-auto">
              {systemPrompt}
            </pre>
          </CollapsibleSection>
        )}
        {userPrompt && (
          <CollapsibleSection
            title="User prompt"
            badge={`${userPromptLength.toLocaleString()} chars`}
          >
            <pre className="whitespace-pre-wrap rounded-md bg-surface-50 p-2 text-xs text-surface-800 max-h-64 overflow-auto">
              {userPrompt}
            </pre>
          </CollapsibleSection>
        )}
        {responseText && (
          <CollapsibleSection
            title="Response"
            defaultOpen={true}
            badge={`${responseLength.toLocaleString()} chars`}
          >
            <pre className="whitespace-pre-wrap rounded-md bg-surface-50 p-2 text-xs text-surface-800 max-h-64 overflow-auto">
              {responseText}
            </pre>
          </CollapsibleSection>
        )}
      </CardContent>
    </Card>
  );
}

type ChunkTracesCardProps = {
  chunks: TimelineChunkTrace[];
  chunkSummaries: string[] | undefined;
};

function ChunkTracesCard({ chunks, chunkSummaries }: ChunkTracesCardProps) {
  const [expandedChunk, setExpandedChunk] = useState<number | null>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Stage 1a: Timeline Chunks ({chunks.length.toString()})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {chunks.map((chunk, index) => {
          const isExpanded = expandedChunk === index;
          const summary = chunkSummaries?.[index];

          return (
            <div
              key={index}
              className="rounded-md border border-surface-200 overflow-hidden"
            >
              <button
                type="button"
                className="w-full flex items-center justify-between px-3 py-2 bg-surface-50 hover:bg-surface-100 text-left"
                onClick={() => {
                  setExpandedChunk(isExpanded ? null : index);
                }}
              >
                <div className="flex items-center gap-2">
                  <svg
                    className={`w-4 h-4 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                  <span className="text-xs font-semibold text-surface-700">
                    Chunk {(chunk.chunkIndex + 1).toString()}: {chunk.timeRange}
                  </span>
                </div>
                <span className="text-xs text-surface-500">
                  {chunk.trace.durationMs}ms
                </span>
              </button>
              {isExpanded && (
                <div className="p-2 space-y-2">
                  <div className="text-xs text-surface-600 space-y-1">
                    <div>Model: {chunk.trace.model.model}</div>
                    {chunk.trace.tokensPrompt !== undefined && (
                      <div>
                        Input tokens:{" "}
                        {chunk.trace.tokensPrompt.toLocaleString()}
                      </div>
                    )}
                    {chunk.trace.tokensCompletion !== undefined && (
                      <div>
                        Output tokens:{" "}
                        {chunk.trace.tokensCompletion.toLocaleString()}
                      </div>
                    )}
                  </div>
                  {summary && (
                    <CollapsibleSection title="Summary" defaultOpen={true}>
                      <pre className="whitespace-pre-wrap rounded-md bg-surface-50 p-2 text-xs text-surface-800 max-h-64 overflow-auto">
                        {summary}
                      </pre>
                    </CollapsibleSection>
                  )}
                </div>
              )}
            </div>
          );
        })}
        <div className="text-xs text-surface-600 pt-2 border-t border-surface-200">
          Total chunk processing time:{" "}
          {chunks.reduce((acc, c) => acc + c.trace.durationMs, 0)}ms
        </div>
      </CardContent>
    </Card>
  );
}

function TimelineSummarySection({
  traces,
  intermediate,
}: {
  traces: PipelineTraces;
  intermediate: PipelineIntermediateResults | undefined;
}) {
  const hasChunks =
    traces.timelineChunks !== undefined && traces.timelineChunks.length > 0;

  if (hasChunks && traces.timelineChunks !== undefined) {
    return (
      <>
        <ChunkTracesCard
          chunks={traces.timelineChunks}
          chunkSummaries={intermediate?.timelineChunkSummaries}
        />
        {traces.timelineAggregate && (
          <TraceCard
            label="Stage 1a: Timeline Aggregate"
            trace={traces.timelineAggregate}
            text={intermediate?.timelineSummaryText}
          />
        )}
      </>
    );
  }

  return (
    <TraceCard
      label="Stage 1a: Timeline Summary"
      trace={traces.timelineSummary}
      text={intermediate?.timelineSummaryText}
    />
  );
}

function ImageSettingsCard({
  intermediate,
}: {
  intermediate: PipelineIntermediateResults | undefined;
}) {
  const hasSettings =
    (intermediate?.selectedImagePrompts?.length ?? 0) > 0 ||
    intermediate?.selectedArtStyle;

  if (!hasSettings) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Image Generation Settings</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-xs text-surface-800">
        {intermediate?.selectedArtStyle && (
          <div>
            <p className="text-surface-600 mb-1">Art style:</p>
            <p className="text-surface-700 bg-surface-50 rounded-md p-2">
              {intermediate.selectedArtStyle}
            </p>
          </div>
        )}
        {intermediate?.selectedImagePrompts &&
          intermediate.selectedImagePrompts.length > 0 && (
            <div>
              <p className="text-surface-600 mb-1">
                {intermediate.selectedImagePrompts.length.toString()} prompt
                {intermediate.selectedImagePrompts.length === 1 ? "" : "s"}{" "}
                selected from personality:
              </p>
              <ul className="list-disc list-inside space-y-1">
                {intermediate.selectedImagePrompts.map((prompt, index) => (
                  <li key={index} className="text-surface-700">
                    {prompt}
                  </li>
                ))}
              </ul>
            </div>
          )}
      </CardContent>
    </Card>
  );
}

function ImageGenerationCard({
  trace,
}: {
  trace: PipelineTraces["imageGeneration"];
}) {
  if (!trace) {
    return null;
  }

  return (
    <Card>
      <CardHeader className="flex items-start justify-between">
        <CardTitle>Stage 4: Image Generation</CardTitle>
        <div className="text-xs text-surface-600">
          {trace.model} · {trace.durationMs}ms
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-xs text-surface-800">
        <CollapsibleSection
          title="Prompt"
          badge={`${trace.request.prompt.length.toLocaleString()} chars`}
        >
          <pre className="whitespace-pre-wrap rounded-md bg-surface-50 p-2 max-h-64 overflow-auto">
            {trace.request.prompt}
          </pre>
        </CollapsibleSection>
        <div className="text-surface-700">
          Generated: {trace.response.imageGenerated ? "yes" : "no"}{" "}
          {trace.response.imageSizeBytes
            ? `(${trace.response.imageSizeBytes.toLocaleString()} bytes)`
            : ""}
        </div>
      </CardContent>
    </Card>
  );
}

type PipelineTracesPanelProps = {
  traces: PipelineTraces | undefined;
  intermediate: PipelineIntermediateResults | undefined;
};

export function PipelineTracesPanel({
  traces,
  intermediate,
}: PipelineTracesPanelProps) {
  if (!traces) {
    return null;
  }

  return (
    <div className="space-y-3">
      <TimelineSummarySection traces={traces} intermediate={intermediate} />
      <TraceCard
        label="Stage 1b: Match Summary"
        trace={traces.matchSummary}
        text={intermediate?.matchSummaryText}
      />
      <TraceCard
        label="Stage 2: Review Text"
        trace={traces.reviewText}
        text={undefined}
      />
      <ImageSettingsCard intermediate={intermediate} />
      <TraceCard
        label="Stage 3: Image Description"
        trace={traces.imageDescription}
        text={intermediate?.imageDescriptionText}
      />
      <ImageGenerationCard trace={traces.imageGeneration} />
    </div>
  );
}
