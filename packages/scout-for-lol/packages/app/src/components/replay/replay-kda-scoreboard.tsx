type ReplayKda = { kills: number; deaths: number; assists: number };
const kdaColumns = ["kills", "deaths", "assists"] as const;

export type ReplayKdaTimeline = {
  actors: readonly { partition: 0 | 1; champion: string | null }[];
  checkpoints: readonly {
    timestampMs: number;
    kda: readonly (ReplayKda | null)[];
  }[];
};

export function ReplayKdaScoreboard(props: {
  timeline: ReplayKdaTimeline;
  timeMs: number;
}) {
  const { actors, checkpoints } = props.timeline;
  const current = checkpoints.findLast(
    ({ timestampMs }) => timestampMs <= props.timeMs,
  );
  const rows = actors.map((actor, slot) => ({
    ...actor,
    label: actor.champion ?? "Unresolved participant",
    slot,
    kda: current?.kda[slot] ?? null,
  }));
  return (
    <div className="mt-5 space-y-2">
      <h3 className="font-semibold">Scoreboard</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        {([0, 1] as const).map((team) => (
          <table
            key={team}
            className="w-full border-separate border-spacing-0 rounded-lg border border-scout-border text-sm"
          >
            <caption className="px-2 pb-1 text-left font-semibold">
              {team === 0 ? "Team A" : "Team B"}
            </caption>
            <thead className="text-scout-subtle">
              <tr>
                <th scope="col" className="p-2 text-left font-medium">
                  Champion
                </th>
                <th scope="col" className="p-2 text-right font-medium">
                  Kills
                </th>
                <th scope="col" className="p-2 text-right font-medium">
                  Deaths
                </th>
                <th scope="col" className="p-2 text-right font-medium">
                  Assists
                </th>
              </tr>
            </thead>
            <tbody>
              {rows
                .filter(({ partition }) => partition === team)
                .map(({ label, slot, kda }) => (
                  <tr key={slot}>
                    <th
                      scope="row"
                      className="border-t border-scout-border p-2 text-left font-medium"
                    >
                      {label}
                    </th>
                    {kda === null ? (
                      <td
                        colSpan={3}
                        className="border-t border-scout-border p-2 text-right text-scout-subtle"
                      >
                        Unverified
                      </td>
                    ) : (
                      kdaColumns.map((stat) => (
                        <td
                          key={stat}
                          className="border-t border-scout-border p-2 text-right tabular-nums"
                        >
                          {kda[stat]}
                        </td>
                      ))
                    )}
                  </tr>
                ))}
            </tbody>
          </table>
        ))}
      </div>
    </div>
  );
}
