import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@scout-for-lol/design-system/components/card";

type Form = {
  games: number;
  wins: number;
  kda: number;
  csPerMinute: number;
} | null;
type Behavior = {
  roleShare: { position: string; games: number; percentage: number }[];
  activityTimes: number[];
  streak: { result: string; games: number; atLeast: boolean } | null;
  recent20: Form;
  currentAct: { name: string; form: Form } | null;
};

function delta(recent: number, act: number, digits = 1): string {
  const difference = recent - act;
  return `${difference >= 0 ? "+" : ""}${difference.toFixed(digits)}`;
}

function ActivityHeatmap(props: { times: number[] }) {
  const counts = Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, () => 0),
  );
  for (const time of props.times) {
    const date = new Date(time);
    const row = counts[date.getDay()];
    if (row !== undefined)
      row[date.getHours()] = (row[date.getHours()] ?? 0) + 1;
  }
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return (
    <div className="max-w-3xl space-y-1 overflow-x-auto">
      <div className="ml-9 flex w-[528px] justify-between text-[10px] text-scout-subtle">
        <span>00:00</span>
        <span>06:00</span>
        <span>12:00</span>
        <span>18:00</span>
        <span>23:00</span>
      </div>
      {counts.map((hours, day) => (
        <div key={days[day]} className="flex min-w-[564px] items-center gap-1">
          <span className="w-8 text-[10px] text-scout-subtle">{days[day]}</span>
          <div className="flex gap-0.5">
            {hours.map((count, hour) => (
              <span
                key={hour}
                title={`${days[day] ?? "Unknown"} ${hour.toString().padStart(2, "0")}:00 — ${count.toString()} recorded games`}
                className={`h-4 w-5 shrink-0 rounded-sm ${count === 0 ? "bg-scout-raised" : count < 3 ? "bg-scout-brand/30" : count < 6 ? "bg-scout-brand/60" : "bg-scout-brand"}`}
              />
            ))}
          </div>
        </div>
      ))}
      <p className="text-xs text-scout-subtle">
        Shown in your local time zone · recorded games only
      </p>
    </div>
  );
}

export function PlayerBehavior(props: { behavior: Behavior | null }) {
  const behavior = props.behavior;
  if (behavior === null) return null;
  const recent = behavior.recent20;
  const act = behavior.currentAct?.form;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Playing patterns</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div>
          <p className="font-medium">Role share</p>
          <div className="mt-1 flex flex-wrap gap-3 text-scout-subtle">
            {behavior.roleShare.length === 0
              ? "No recorded roles"
              : behavior.roleShare.map((role) => (
                  <span key={role.position}>
                    {role.position}: {role.percentage.toString()}% (
                    {role.games.toString()})
                  </span>
                ))}
          </div>
        </div>
        <p>
          Current recorded streak:{" "}
          {behavior.streak === null
            ? "No games"
            : `${behavior.streak.atLeast ? "at least " : ""}${behavior.streak.games.toString()} ${behavior.streak.result}${behavior.streak.games === 1 ? "" : "s"}`}
        </p>
        <div>
          <p className="mb-2 font-medium">Activity by local day and hour</p>
          <ActivityHeatmap times={behavior.activityTimes} />
        </div>
        <div>
          <p className="font-medium">Recent 20 vs. current Riot act</p>
          {act === undefined ||
          act === null ||
          recent === null ||
          behavior.currentAct === null ? (
            <p className="text-scout-subtle">
              Current act comparison unavailable until Riot act dates and
              recorded games are available.
            </p>
          ) : (
            <p className="text-scout-subtle">
              {behavior.currentAct.name} ({act.games.toString()} games): win
              rate{" "}
              {delta(
                (recent.wins / recent.games) * 100,
                (act.wins / act.games) * 100,
              )}{" "}
              pts · KDA {delta(recent.kda, act.kda, 2)} · CS/min{" "}
              {delta(recent.csPerMinute, act.csPerMinute)}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
