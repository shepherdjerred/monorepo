import { useContext, useState } from "react";
import { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import type { ExploreTraceRawValue } from "@scout-for-lol/data";
import { Button } from "@scout-for-lol/design-system/components/button";
import { useTRPC } from "#src/lib/query/trpc.ts";
import { ToolPayloadContext } from "#src/lib/explore/tool-payload-context.ts";
import { MarkdownAnswer } from "#src/components/scoutql/markdown-answer.tsx";

type Props = {
  label: string;
  toolCallId: string;
  toolName: string;
  payload: ExploreTraceRawValue;
};

export function ExplorePayloadViewer(props: Props) {
  const access = useContext(ToolPayloadContext);
  if (access === null || props.payload.kind === "value") {
    return (
      <PayloadContents
        label={props.label}
        value={props.payload.kind === "value" ? props.payload.value : null}
        skill={props.toolName === "load_skill"}
      />
    );
  }
  return <LazyPayload {...props} access={access} />;
}

function LazyPayload(
  props: Props & {
    access: NonNullable<React.ContextType<typeof ToolPayloadContext>>;
  },
) {
  const trpc = useTRPC();
  const [opened, setOpened] = useState(false);
  const query = useQuery(
    trpc.explore.toolPayload.queryOptions(
      {
        ...props.access,
        toolCallId: props.toolCallId,
        direction:
          props.label === "Input"
            ? "input"
            : props.label === "Dataset"
              ? "dataset"
              : "output",
      },
      { enabled: opened, retry: false },
    ),
  );
  return (
    <div className="space-y-2">
      {!opened && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setOpened(true);
          }}
        >
          View full {props.label.toLowerCase()}
        </Button>
      )}
      {query.isFetching && <p>Loading {props.label.toLowerCase()}…</p>}
      {query.isError && (
        <div role="alert">
          Could not load this payload.{" "}
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void query.refetch();
            }}
          >
            Retry
          </Button>
        </div>
      )}
      {opened && !query.isFetching && !query.isError && (
        <PayloadContents
          label={props.label}
          value={query.data ?? null}
          skill={props.toolName === "load_skill"}
        />
      )}
    </div>
  );
}

function PayloadContents(props: {
  label: string;
  value: unknown;
  skill: boolean;
}) {
  const [full, setFull] = useState(false);
  if (props.value === null)
    return (
      <p className="text-scout-subtle">
        Details were not recorded or are unavailable in this shared view.
      </p>
    );
  const json = JSON.stringify(props.value, null, 2);
  const skillPayload = z
    .object({ instructions: z.string() })
    .safeParse(props.value);
  const instructions =
    props.skill && skillPayload.success ? skillPayload.data.instructions : null;
  const download = () => {
    const url = URL.createObjectURL(
      new Blob([json], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `tool-${props.label.toLowerCase()}.json`;
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 0);
  };
  return (
    <div className="space-y-2">
      <p className="font-medium">{props.label}</p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void navigator.clipboard.writeText(json);
          }}
        >
          Copy {props.label.toLowerCase()}
        </Button>
        <Button variant="outline" size="sm" onClick={download}>
          Download JSON
        </Button>
        {json.length > 4000 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setFull(!full);
            }}
          >
            {full ? "Show preview" : "View full payload"}
          </Button>
        )}
      </div>
      {instructions === null ? (
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md bg-scout-hover/50 p-3 font-mono text-xs">
          {full ? json : json.slice(0, 4000)}
          {!full && json.length > 4000
            ? "\n… Preview; full payload available above."
            : ""}
        </pre>
      ) : (
        <div className="max-h-96 overflow-auto">
          <MarkdownAnswer>{instructions}</MarkdownAnswer>
        </div>
      )}
    </div>
  );
}
