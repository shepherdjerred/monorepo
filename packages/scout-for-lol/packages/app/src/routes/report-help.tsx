import { Link, useParams } from "react-router";
import { Button } from "@scout-for-lol/design-system/components/button";
import { ReportQueryDocs } from "#src/components/report-query-docs.tsx";

export function ReportHelp() {
  const { guildId } = useParams();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold tracking-tight">
          Report query reference
        </h2>
        {guildId !== undefined && (
          <Button asChild variant="outline" size="sm">
            <Link to={`/g/${guildId}/reports`}>Back</Link>
          </Button>
        )}
      </div>
      <p className="text-sm text-scout-subtle">
        The report query language is a small SQL-like dialect. Pick a source,
        select metrics, group, filter, analyze time windows, and choose a
        visualization. Everything below is also available as autocomplete and
        hover help in the editor.
      </p>
      <ReportQueryDocs />
    </div>
  );
}
