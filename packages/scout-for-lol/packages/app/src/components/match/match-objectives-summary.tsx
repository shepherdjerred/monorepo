type MatchObjectives = {
  turrets: number;
  inhibitors: number;
  barons: number;
  dragons: number;
};

export function MatchObjectivesSummary(props: { objectives: MatchObjectives }) {
  const { objectives } = props;
  return (
    <>
      {objectives.turrets.toString()} turrets ·{" "}
      {objectives.inhibitors.toString()} inhibitors ·{" "}
      {objectives.dragons.toString()} dragons · {objectives.barons.toString()}{" "}
      barons
    </>
  );
}
