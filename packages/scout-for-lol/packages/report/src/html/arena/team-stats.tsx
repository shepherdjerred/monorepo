export function TeamStats({
  kills,
  deaths,
  assists,
}: {
  kills: number;
  deaths: number;
  assists: number;
}) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <div style={{ fontSize: 20, opacity: 0.7 }}>K/D/A</div>
      <div
        style={{
          display: "flex",
          fontSize: 24,
          fontWeight: 600,
          color: kills > deaths ? "#10b981" : "#ef4444",
        }}
      >
        {kills}/{deaths}/{assists}
      </div>
    </div>
  );
}
