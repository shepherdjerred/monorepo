import { formatReportQuery } from "@scout-for-lol/data";

export function ReportQueryViewer(props: { queryText: string }) {
  return (
    <pre className="max-h-[360px] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted/50 p-3 font-mono text-xs leading-5">
      {formatReportQuery(props.queryText)}
    </pre>
  );
}
