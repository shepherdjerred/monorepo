import { SCOUTQL_IDIOMS } from "@scout-for-lol/data/model/scoutql/scoutql-idioms.ts";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@scout-for-lol/design-system/components/card";
import { ScoutQlCode } from "#src/components/scoutql-code.tsx";
import {
  SCOUTQL_SHAPE_EXAMPLE,
  scoutQlClauseSummary,
} from "#src/lib/scoutql-clause-summary.ts";
import {
  scoutQlFunctionSections,
  scoutQlKeywordList,
  scoutQlQueueItems,
  scoutQlRenderKindItems,
  scoutQlRenderOptionNames,
  scoutQlSourceSections,
  scoutQlTimeBoundItems,
  type DocsDefinition,
} from "#src/lib/report-query-docs-sections.ts";

// ── The in-app ScoutQL reference ─────────────────────────────────────────────
// Presentation only: every list on this page is built in
// `report-query-docs-sections.ts` from the language's own registries, so this
// component holds no facts about ScoutQL that could go stale independently of
// the parser.

function DefinitionList(props: { items: DocsDefinition[] }) {
  return (
    <dl className="space-y-1.5">
      {props.items.map((item) => (
        <div
          key={item.term}
          className="grid grid-cols-[minmax(8rem,auto)_1fr] gap-3"
        >
          <dt className="font-mono text-xs text-scout-ink">{item.term}</dt>
          <dd className="text-xs text-scout-subtle">{item.description}</dd>
        </div>
      ))}
    </dl>
  );
}

function DocsSection(props: {
  title: string;
  blurb?: string;
  items: DocsDefinition[];
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{props.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {props.blurb !== undefined && (
          <p className="text-xs text-scout-subtle">{props.blurb}</p>
        )}
        <DefinitionList items={props.items} />
      </CardContent>
    </Card>
  );
}

function TokenList(props: { title: string; blurb: string; tokens: string[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{props.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-scout-subtle">{props.blurb}</p>
        <div className="flex flex-wrap gap-1.5">
          {props.tokens.map((token) => (
            <code
              key={token}
              className="rounded bg-scout-hover/60 px-1.5 py-0.5 font-mono text-xs text-scout-ink"
            >
              {token}
            </code>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function ClauseOrderSection() {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">The shape of a query</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <ScoutQlCode queryText={SCOUTQL_SHAPE_EXAMPLE} />
        <p className="text-xs text-scout-subtle">
          ScoutQL is a subset of DuckDB SQL: clauses come in this order,
          keywords are case-insensitive, strings use single quotes, and{" "}
          <code>--</code> starts a comment. Only SELECT and FROM are required.
        </p>
        <dl className="space-y-1.5">
          {scoutQlClauseSummary().map((clause) => (
            <div
              key={clause.clause}
              className="grid grid-cols-[minmax(10rem,auto)_1fr] gap-3"
            >
              <dt className="font-mono text-xs text-scout-ink">
                {clause.syntax}
              </dt>
              <dd className="text-xs text-scout-subtle">
                {clause.required && (
                  <span className="mr-1 font-medium text-scout-ink">
                    Required.
                  </span>
                )}
                {clause.description}
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

function SourcesSection() {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Sources and columns</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-scout-subtle">
          A query reads one source. Columns are the lake&apos;s own columns,
          plus a few dimensions Scout computes.
        </p>
        {scoutQlSourceSections().map((source) => (
          <details
            key={source.id}
            className="rounded-md border border-scout-border"
          >
            <summary className="cursor-pointer px-3 py-2 text-xs">
              <span className="font-mono text-scout-ink">{source.id}</span>
              <span className="ml-2 text-scout-subtle">
                {source.description}
              </span>
            </summary>
            <div className="space-y-2 border-t border-scout-border p-3">
              <p className="text-xs text-scout-subtle">{source.timeNote}</p>
              <DefinitionList items={source.columns} />
            </div>
          </details>
        ))}
      </CardContent>
    </Card>
  );
}

function RecipesSection() {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Recipes</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-scout-subtle">
          The idioms worth knowing. Each one is a complete, runnable query.
        </p>
        {SCOUTQL_IDIOMS.map((idiom) => (
          <section key={idiom.id} className="space-y-1.5">
            <h4 className="text-xs font-semibold text-scout-ink">
              {idiom.title}
            </h4>
            <p className="text-xs text-scout-subtle">{idiom.description}</p>
            <ScoutQlCode queryText={idiom.query} />
          </section>
        ))}
      </CardContent>
    </Card>
  );
}

export function ReportQueryDocs() {
  return (
    <div className="space-y-3">
      <ClauseOrderSection />
      <SourcesSection />
      {scoutQlFunctionSections().map((section) => (
        <DocsSection
          key={section.title}
          title={section.title}
          blurb={section.blurb}
          items={section.items}
        />
      ))}
      <DocsSection
        title="Time bounds"
        blurb="Time is an ordinary WHERE condition — there is no separate period clause."
        items={scoutQlTimeBoundItems()}
      />
      <DocsSection title="Render kinds" items={scoutQlRenderKindItems()} />
      <TokenList
        title="Render options (WITH)"
        blurb="Chart options. The editor completes each one and describes it on hover."
        tokens={[...scoutQlRenderOptionNames()]}
      />
      <DocsSection
        title="Queue values"
        blurb="Compare against the queue column, e.g. WHERE queue IN ('solo', 'flex')."
        items={scoutQlQueueItems()}
      />
      <TokenList
        title="Keywords"
        blurb="Reserved words, from the grammar's own token definitions."
        tokens={[...scoutQlKeywordList()]}
      />
      <RecipesSection />
    </div>
  );
}
