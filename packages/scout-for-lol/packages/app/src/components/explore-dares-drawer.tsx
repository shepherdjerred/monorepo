import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Target } from "lucide-react";
import type {
  DareCompiledPlanV2,
  DareDeadlineSpecV2,
} from "@scout-for-lol/data";
import { Button } from "@scout-for-lol/design-system/components/button";
import { Input } from "@scout-for-lol/design-system/components/input";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@scout-for-lol/design-system/components/sheet";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@scout-for-lol/design-system/components/tabs";
import { ScoutQlCode } from "#src/components/scoutql-code.tsx";
import { ExploreDareEditor } from "#src/components/explore-dare-editor.tsx";
import { dareEditorInstanceKey } from "#src/lib/dare-editor-state.ts";
import { useTRPC } from "#src/lib/trpc.ts";

export function ExploreDaresDrawer() {
  const trpc = useTRPC();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<"mine" | "guild">("mine");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const list = useQuery({
    ...trpc.explore.dareList.queryOptions({
      scope,
      ...(search.trim().length === 0 ? {} : { search: search.trim() }),
    }),
    enabled: open,
  });
  const detail = useQuery({
    ...trpc.explore.dareInspect.queryOptions({ dareId: selectedId ?? 0 }),
    enabled: open && selectedId !== null,
  });

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Target className="size-4" />
          Dares
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetTitle className="text-base font-semibold">Scout dares</SheetTitle>
        <Tabs
          value={scope}
          onValueChange={(next) => {
            if (next === "mine" || next === "guild") {
              setScope(next);
              setSelectedId(null);
            }
          }}
          className="mt-4"
        >
          <TabsList>
            <TabsTrigger value="mine">My Dares</TabsTrigger>
            <TabsTrigger value="guild">Guild Dares</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="relative mt-4">
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

        {detail.data === undefined ? (
          <DareList
            loading={list.isLoading}
            error={list.error}
            dares={list.data ?? []}
            onSelect={setSelectedId}
          />
        ) : (
          <DareDetail
            dare={detail.data}
            onBack={() => {
              setSelectedId(null);
            }}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function DareList(props: {
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
  onSelect: (dareId: number) => void;
}) {
  if (props.loading) {
    return <p className="mt-6 text-sm text-scout-subtle">Loading dares…</p>;
  }
  if (props.error !== null) {
    return (
      <p className="mt-6 text-sm text-scout-danger">{props.error.message}</p>
    );
  }
  if (props.dares.length === 0) {
    return <p className="mt-6 text-sm text-scout-subtle">No dares match.</p>;
  }
  return (
    <ul className="mt-4 space-y-2">
      {props.dares.map((dare) => (
        <li key={dare.id}>
          <button
            type="button"
            className="w-full space-y-2 rounded-lg border border-scout-border p-3 text-left hover:bg-scout-hover"
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

function DareDetail(props: {
  dare: {
    id: number;
    state: string;
    currentRevision: number;
    fundedRevision: number | null;
    plainLanguage: string;
    canonicalScoutQl: string;
    plan: DareCompiledPlanV2;
    semanticProofPlan: string;
    originalText: string;
    deadlineSpec: DareDeadlineSpecV2;
    targetAliases: string[];
    openingStake: number;
    potTotal: number;
    evidenceGames: number;
    deadlineAt: string | null;
    finalValue: boolean | null;
    voidReason: string | null;
  };
  onBack: () => void;
}) {
  const revision = props.dare.fundedRevision ?? props.dare.currentRevision;
  return (
    <div className="mt-4 space-y-4">
      <Button type="button" variant="ghost" size="sm" onClick={props.onBack}>
        ← Back to dares
      </Button>
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-medium">Dare #{props.dare.id.toString()}</h3>
        <StatePill state={props.dare.state} />
      </div>
      {props.dare.state === "draft" && (
        <ExploreDareEditor
          key={dareEditorInstanceKey(props.dare)}
          dare={props.dare}
        />
      )}
      <p className="whitespace-pre-wrap text-sm">{props.dare.plainLanguage}</p>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <Fact label="Revision" value={revision.toString()} />
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
        <Fact
          label="Deadline"
          value={
            props.dare.deadlineAt === null
              ? "Starts after acceptance"
              : new Date(props.dare.deadlineAt).toLocaleString()
          }
        />
      </dl>
      <section className="space-y-2">
        <h4 className="text-sm font-medium">ScoutQL</h4>
        <ScoutQlCode queryText={props.dare.canonicalScoutQl} />
      </section>
      <section className="space-y-2">
        <h4 className="text-sm font-medium">Proof plan</h4>
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
