import {
  REPORT_EXAMPLES,
  REPORT_FILTERS,
  REPORT_GROUP_BYS,
  REPORT_KEYWORDS,
  REPORT_METRICS,
  REPORT_SOURCES,
  reportQueueValues,
} from "@scout-for-lol/data";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "#src/components/ui/card.tsx";
import { Button } from "#src/components/ui/button.tsx";

const GRAMMAR =
  "SELECT <metrics> FROM <source> [WHERE <filter> AND …] GROUP BY <field> [ORDER BY <metric|label> ASC|DESC] [LIMIT <n>]";

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

export function ReportQueryDocs(props: {
  onUseExample?: (query: string) => void;
}) {
  const { onUseExample } = props;
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
            Keywords are case-insensitive. WHERE clauses are AND-joined. ORDER
            BY defaults to <span className="font-mono">games DESC</span>.
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

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Examples</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {REPORT_EXAMPLES.map((example) => (
            <div key={example.title} className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium">{example.title}</span>
                {onUseExample !== undefined && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      onUseExample(example.query);
                    }}
                  >
                    Use
                  </Button>
                )}
              </div>
              <pre className="overflow-auto whitespace-pre-wrap rounded-md bg-muted/50 p-2 text-xs">
                {example.query}
              </pre>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
