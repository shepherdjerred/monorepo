import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { Button } from "@scout-for-lol/design-system/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@scout-for-lol/design-system/components/card";
import { DuelOptionSelectField } from "#src/components/duel-form-fields.tsx";
import { useDuelGuildParams } from "#src/lib/route-params.ts";
import { useTRPC } from "#src/lib/trpc.ts";

function HeadToHeadRecordCard(props: {
  label: string;
  record: { readonly wins: number; readonly losses: number } | null;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{props.label}</CardTitle>
      </CardHeader>
      <CardContent>
        {props.record === null ? (
          <p className="text-sm text-scout-subtle">
            No games against this opponent.
          </p>
        ) : (
          <p className="text-2xl font-semibold">
            {props.record.wins.toString()}–{props.record.losses.toString()}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function DuelHeadToHead() {
  const { guildId } = useDuelGuildParams();
  const trpc = useTRPC();
  const [scope, setScope] = useState<"individual" | "pair">("individual");
  const [first, setFirst] = useState("");
  const [second, setSecond] = useState("");
  const records = useQuery(
    trpc.duel.rollingRecords.queryOptions({ guildId, scope }),
  );
  const comparison = useQuery(
    trpc.duel.headToHead.queryOptions(
      { guildId, scope, firstSubjectKey: first, secondSubjectKey: second },
      { enabled: first.length > 0 && second.length > 0 && first !== second },
    ),
  );
  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:py-12">
      <Link
        className="text-sm text-scout-subtle hover:underline"
        to={`/duels/${guildId}`}
      >
        ← Duels
      </Link>
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Head to head</h1>
        <p className="mt-2 text-scout-subtle">
          Every verified played game contributes. No-show advancements never do.
        </p>
      </header>
      <form
        className="grid gap-4 rounded-lg border p-4 md:grid-cols-3"
        onSubmit={(event) => {
          event.preventDefault();
          void comparison.refetch();
        }}
      >
        <label className="grid gap-1 text-sm" htmlFor="h2h-scope">
          <span className="font-medium">Record</span>
          <select
            className="scout-control"
            id="h2h-scope"
            name="scope"
            value={scope}
            onChange={(event) => {
              setScope(
                event.currentTarget.value === "pair" ? "pair" : "individual",
              );
              setFirst("");
              setSecond("");
            }}
          >
            <option value="individual">Individuals</option>
            <option value="pair">Pairs</option>
          </select>
        </label>
        <DuelOptionSelectField
          id="h2h-first"
          name="first"
          label="First"
          value={first}
          placeholder="Choose"
          options={(records.data ?? []).map((record) => ({
            value: record.subjectKey,
            label: record.label,
          }))}
          onChange={setFirst}
        />
        <DuelOptionSelectField
          id="h2h-second"
          name="second"
          label="Second"
          value={second}
          placeholder="Choose"
          options={(records.data ?? []).map((record) => ({
            value: record.subjectKey,
            label: record.label,
          }))}
          onChange={setSecond}
        />
        <Button type="submit">Compare</Button>
      </form>
      {comparison.data === undefined ? null : (
        <div className="grid gap-4 md:grid-cols-2">
          <HeadToHeadRecordCard
            label={
              records.data?.find((record) => record.subjectKey === first)
                ?.label ?? first
            }
            record={comparison.data.first}
          />
          <HeadToHeadRecordCard
            label={
              records.data?.find((record) => record.subjectKey === second)
                ?.label ?? second
            }
            record={comparison.data.second}
          />
        </div>
      )}
    </div>
  );
}
