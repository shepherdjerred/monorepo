import {
  REPORT_FILTERS,
  REPORT_FUNCTIONS,
  REPORT_GROUP_BYS,
  REPORT_KEYWORDS,
  REPORT_METRICS,
  REPORT_RENDER_KINDS,
  REPORT_RENDER_OPTIONS,
  REPORT_SOURCES,
  reportQueueValues,
} from "@scout-for-lol/data";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "#src/components/ui/card.tsx";

const GRAMMAR =
  "SELECT <metric|expression [AS alias]>, … FROM <source> [WHERE <row filter> AND …] GROUP BY <field>[, <field>] [HAVING <output> <operator> <value>] [ORDER BY <output|label> ASC|DESC] [LIMIT <n>] [RENDER <kind> [WITH (<options>)]]";

type DefinitionItem = { term: string; description: string };

function DefinitionList(props: { items: DefinitionItem[] }) {
  return (
    <dl className="space-y-1.5">
      {props.items.map((item) => (
        <div
          key={item.term}
          className="grid grid-cols-[minmax(8rem,auto)_1fr] gap-3"
        >
          <dt className="font-mono text-xs text-foreground">{item.term}</dt>
          <dd className="text-xs text-muted-foreground">{item.description}</dd>
        </div>
      ))}
    </dl>
  );
}

function DocsSection(props: { title: string; items: DefinitionItem[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{props.title}</CardTitle>
      </CardHeader>
      <CardContent>
        <DefinitionList items={props.items} />
      </CardContent>
    </Card>
  );
}

export function ReportQueryDocs() {
  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Syntax</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="overflow-auto whitespace-pre-wrap rounded-md bg-muted/50 p-3 text-xs">
            {GRAMMAR}
          </pre>
          <p className="mt-2 text-xs text-muted-foreground">
            Keywords are case-insensitive. WHERE filters raw rows; HAVING
            filters aggregates and aliases. Arithmetic supports parentheses and
            <span className="font-mono"> + − × ÷</span>. Temporal grouping uses
            UTC day, week, and month buckets.
          </p>
        </CardContent>
      </Card>

      <DocsSection
        title="Sources (FROM)"
        items={REPORT_SOURCES.map((source) => ({
          term: source.id,
          description: source.description,
        }))}
      />

      <DocsSection
        title="Metrics (SELECT)"
        items={REPORT_METRICS.map((metric) => ({
          term: metric.id,
          description: `${metric.label} — ${metric.description}`,
        }))}
      />

      <DocsSection
        title="Calculated outputs"
        items={REPORT_FUNCTIONS.map((fn) => ({
          term: fn.syntax,
          description: fn.description,
        }))}
      />

      <DocsSection
        title="Group by"
        items={REPORT_GROUP_BYS.map((groupBy) => ({
          term: groupBy.id,
          description: groupBy.description,
        }))}
      />

      <DocsSection
        title="Filters (WHERE)"
        items={REPORT_FILTERS.map((filter) => ({
          term: filter.syntax,
          description: filter.description,
        }))}
      />

      <DocsSection
        title="Render kinds"
        items={REPORT_RENDER_KINDS.map((kind) => ({
          term: kind.id,
          description: kind.description,
        }))}
      />

      <DocsSection
        title="Render options (WITH)"
        items={REPORT_RENDER_OPTIONS.map((option) => ({
          term: option.syntax,
          description: option.description,
        }))}
      />

      <DocsSection
        title="Keywords"
        items={REPORT_KEYWORDS.map((keyword) => ({
          term: keyword.keyword,
          description: keyword.description,
        }))}
      />

      <DocsSection
        title="Queue values"
        items={reportQueueValues().map((queue) => ({
          term: queue.id,
          description: queue.label,
        }))}
      />
    </div>
  );
}
