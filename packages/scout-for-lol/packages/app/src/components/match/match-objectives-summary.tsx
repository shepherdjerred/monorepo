type MatchObjectives = {
  turrets: number;
  inhibitors: number;
  barons: number;
  dragons: number;
};

export function MatchObjectivesSummary(props: {
  objectives: MatchObjectives | null;
}) {
  const { objectives } = props;
  // A record that states no team objectives says so rather than showing zeros.
  if (objectives === null) return <>Team objectives not recorded</>;
  return (
    <>
      {objectives.turrets.toString()} turrets ·{" "}
      {objectives.inhibitors.toString()} inhibitors ·{" "}
      {objectives.dragons.toString()} dragons · {objectives.barons.toString()}{" "}
      barons
    </>
  );
}
