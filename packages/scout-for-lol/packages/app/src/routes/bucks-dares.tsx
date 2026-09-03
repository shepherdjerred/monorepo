import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router";
import { z } from "zod";
import type { DareDeadlineSpecV2 } from "@scout-for-lol/data";
import { BucksDareEditor } from "#src/components/bucks-dare-editor.tsx";
import { ScoutQlCode } from "#src/components/scoutql-code.tsx";
import { Button } from "@scout-for-lol/design-system/components/button";
import { Input } from "@scout-for-lol/design-system/components/input";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@scout-for-lol/design-system/components/tabs";
import {
  ErrorState,
  LoadingState,
} from "@scout-for-lol/design-system/domain/states";
import { EmptyState } from "@scout-for-lol/design-system/layout";
import { dareDeadlineDescription } from "#src/lib/dare-deadline.ts";
import { dareEditorInstanceKey } from "#src/lib/dare-editor-state.ts";
import { useTRPC } from "#src/lib/trpc.ts";
import { useBucksGuild } from "#src/routes/bucks-workspace.tsx";

const DareIdSchema = z.coerce.number().int().positive();

export function parseBucksDareId(
  value: string | undefined,
): { kind: "list" } | { kind: "detail"; dareId: number } | { kind: "invalid" } {
  if (value === undefined) return { kind: "list" };
  const parsed = DareIdSchema.safeParse(value);
  return parsed.success
    ? { kind: "detail", dareId: parsed.data }
    : { kind: "invalid" };
}

export function BucksDares() {
  const { guildId, guildName, daresAvailable } = useBucksGuild();
  const { dareId: dareIdParam } = useParams();
  const route = parseBucksDareId(dareIdParam);

  if (!daresAvailable) {
    return (
      <EmptyState>
        <h2>Dares aren&apos;t available here</h2>
        <p>This server doesn&apos;t currently have Dares to manage.</p>
        <Button asChild variant="outline">
          <Link to="/bucks">Back to Bryan Bucks</Link>
        </Button>
      </EmptyState>
    );
  }
  if (route.kind === "invalid") {
    return <ErrorState message="This Dare link isn't valid." />;
  }
  return route.kind === "detail" ? (
    <DareDetailPage guildId={guildId} dareId={route.dareId} />
  ) : (
    <DareListPage guildId={guildId} guildName={guildName} />
  );
}

function DareListPage(props: { guildId: string; guildName: string }) {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const [scope, setScope] = useState<"mine" | "guild">("mine");
  const [search, setSearch] = useState("");
  const trimmedSearch = search.trim();
  const list = useQuery(
    trpc.bucks.dareList.queryOptions({
      guildId: props.guildId,
      scope,
      ...(trimmedSearch.length === 0 ? {} : { search: trimmedSearch }),
    }),
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Dares</h1>
          <p className="text-sm text-scout-subtle">
            Find and manage Dare contracts for {props.guildName}. Create or
            revise one conversationally in Explore.
          </p>
        </div>
        <Button asChild>
          <Link to="/explore">Create in Explore</Link>
        </Button>
      </header>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs
          value={scope}
          onValueChange={(next) => {
            if (next === "mine" || next === "guild") setScope(next);
          }}
        >
          <TabsList>
            <TabsTrigger value="mine">My Dares</TabsTrigger>
            <TabsTrigger value="guild">Guild Dares</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative sm:w-80">
          <Search className="absolute top-1/2 left-2 size-4 -translate-y-1/2 text-scout-subtle" />
          <Input
            aria-label="Search dares"
            placeholder="Search dares or targets"
            value={search}
            className="pl-8"
            onChange={(event) => {
              setSearch(event.target.value);
            }}
          />
        </div>
      </div>

      <DareList
        loading={list.isPending}
        error={list.error}
        dares={list.data ?? []}
        onRetry={() => {
          void list.refetch();
        }}
        onSelect={(dareId) => {
          void navigate(`/bucks/dares/${dareId.toString()}`);
        }}
      />
    </div>
  );
}

export function DareList(props: {
  loading: boolean;
  error: { message: string } | null;
  dares: {
    id: number;
    state: string;
    plainLanguage: string;
    targetAliases: string[];
    potTotal: number;
    evidenceGames: number;
    updatedAt: string;
  }[];
  onRetry: () => void;
  onSelect: (dareId: number) => void;
}) {
  if (props.loading) return <LoadingState label="Loading dares…" />;
  if (props.error !== null) {
    return <ErrorState message={props.error.message} onRetry={props.onRetry} />;
  }
  if (props.dares.length === 0) {
    return (
      <EmptyState>
        <h2>No dares match</h2>
        <p>Try another search or create a Dare in Explore.</p>
      </EmptyState>
    );
  }
  return (
    <ul className="grid gap-3 lg:grid-cols-2">
      {props.dares.map((dare) => (
        <li key={dare.id}>
          <button
            type="button"
            className="h-full w-full space-y-3 rounded-lg border border-scout-border p-4 text-left hover:bg-scout-hover"
            onClick={() => {
              props.onSelect(dare.id);
            }}
          >
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-medium">Dare #{dare.id.toString()}</span>
              <StatePill state={dare.state} />
            </div>
            <p className="line-clamp-3 whitespace-pre-wrap text-sm">
              {dare.plainLanguage}
            </p>
            <p className="text-xs text-scout-subtle">
              {dare.targetAliases.join(", ")} · {dare.potTotal.toString()} BB ·{" "}
              {dare.evidenceGames.toString()} evidence games
            </p>
          </button>
        </li>
      ))}
    </ul>
  );
}

function DareDetailPage(props: { guildId: string; dareId: number }) {
  const trpc = useTRPC();
  const detail = useQuery(
    trpc.bucks.dareInspect.queryOptions({
      guildId: props.guildId,
      dareId: props.dareId,
    }),
  );
  if (detail.isPending) return <LoadingState label="Loading dare…" />;
  if (detail.isError) {
    return (
      <ErrorState
        message={detail.error.message}
        onRetry={() => {
          void detail.refetch();
        }}
      />
    );
  }
  return <DareDetail guildId={props.guildId} dare={detail.data} />;
}

export function DareDetail(props: {
  guildId: string;
  dare: {
    id: number;
    state: string;
    originConversationId: string | null;
    currentRevision: number;
    fundedRevision: number | null;
    plainLanguage: string;
    canonicalScoutQl: string;
    semanticProofPlan: string;
    compilerVersion: string;
    evaluatorVersion: string;
    scoutQlPlanHash: string | null;
    originalText: string;
    deadlineSpec: DareDeadlineSpecV2;
    targetAliases: string[];
    openingStake: number;
    potTotal: number;
    evidenceGames: number;
    acceptDeadline: string | null;
    deadlineAt: string | null;
    finalValue: boolean | null;
    proof: unknown;
    voidReason: string | null;
  };
}) {
  const revision = props.dare.fundedRevision ?? props.dare.currentRevision;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link to="/bucks/dares">← Back to dares</Link>
        </Button>
        {props.dare.state === "draft" &&
          props.dare.originConversationId !== null && (
            <Button asChild variant="outline" size="sm">
              <Link to={`/explore/${props.dare.originConversationId}`}>
                Revise in Explore
              </Link>
            </Button>
          )}
      </div>
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">
          Dare #{props.dare.id.toString()}
        </h1>
        <StatePill state={props.dare.state} />
      </div>
      {props.dare.state === "draft" && (
        <BucksDareEditor
          key={dareEditorInstanceKey(props.dare)}
          guildId={props.guildId}
          dare={props.dare}
        />
      )}
      <p className="whitespace-pre-wrap text-sm">{props.dare.plainLanguage}</p>
      <p className="text-xs text-scout-subtle">
        Original wording: {props.dare.originalText}
      </p>
      <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <Fact label="Revision" value={revision.toString()} />
        <Fact
          label="Compiler"
          value={`${props.dare.compilerVersion} / ${props.dare.evaluatorVersion}`}
        />
        <Fact label="Targets" value={props.dare.targetAliases.join(", ")} />
        <Fact
          label="Opening stake"
          value={`${props.dare.openingStake.toString()} BB`}
        />
        <Fact label="Pot" value={`${props.dare.potTotal.toString()} BB`} />
        <Fact
          label="Evidence"
          value={`${props.dare.evidenceGames.toString()} games`}
        />
        <Fact label="Deadline" value={dareDeadlineDescription(props.dare)} />
        {props.dare.acceptDeadline !== null && (
          <Fact
            label="Accept by"
            value={new Date(props.dare.acceptDeadline).toLocaleString()}
          />
        )}
      </dl>
      <section className="space-y-2">
        <h2 className="text-sm font-medium">
          {props.dare.compilerVersion === "dare-sql-3"
            ? "Binding SQL contract"
            : "ScoutQL"}
        </h2>
        {props.dare.compilerVersion === "dare-sql-3" && (
          <p className="text-xs text-scout-subtle">
            This canonical SQL is authoritative; the readable summary is
            explanatory.
          </p>
        )}
        <ScoutQlCode queryText={props.dare.canonicalScoutQl} />
        {props.dare.scoutQlPlanHash !== null && (
          <p className="font-mono text-xs text-scout-subtle">
            Immutable plan {props.dare.scoutQlPlanHash}
          </p>
        )}
      </section>
      {props.dare.proof !== null && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium">Settlement proof</h2>
          <pre className="max-h-96 overflow-auto rounded-md border border-scout-border bg-scout-surface p-3 text-xs whitespace-pre-wrap">
            {JSON.stringify(props.dare.proof, null, 2)}
          </pre>
        </section>
      )}
      <section className="space-y-2">
        <h2 className="text-sm font-medium">Proof plan</h2>
        <p className="whitespace-pre-wrap text-xs text-scout-subtle">
          {props.dare.semanticProofPlan}
        </p>
      </section>
      {props.dare.voidReason !== null && (
        <p className="text-sm text-scout-danger">
          Voided: {props.dare.voidReason.replaceAll("_", " ")}
        </p>
      )}
    </div>
  );
}

function Fact(props: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-scout-subtle">{props.label}</dt>
      <dd>{props.value}</dd>
    </div>
  );
}

function StatePill(props: { state: string }) {
  return (
    <span className="rounded-full border border-scout-border px-2 py-0.5 text-xs capitalize">
      {props.state.replaceAll("_", " ")}
    </span>
  );
}
