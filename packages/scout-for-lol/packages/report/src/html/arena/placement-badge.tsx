import { type ArenaPlacement, formatArenaPlacement } from "@scout-for-lol/data";

export function PlacementBadge({ placement }: { placement: ArenaPlacement }) {
  return (
    <div
      style={{
        background:
          placement === 1
            ? "linear-gradient(135deg, #ffd700 0%, #ffed4e 100%)"
            : placement === 2
              ? "linear-gradient(135deg, #c0c0c0 0%, #e8e8e8 100%)"
              : placement === 3
                ? "linear-gradient(135deg, #cd7f32 0%, #deb887 100%)"
                : "#6b7280",
        color: placement <= 3 ? "#000" : "#fff",
        borderRadius: "50%",
        width: 52,
        height: 52,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 24,
        fontWeight: 800,
        border: placement <= 3 ? "2px solid rgba(255, 255, 255, 0.2)" : "none",
        boxShadow:
          placement <= 3
            ? "0 2px 8px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.3)"
            : "0 2px 4px rgba(0, 0, 0, 0.2)",
        textShadow: placement <= 3 ? "0 1px 1px rgba(0, 0, 0, 0.3)" : "none",
      }}
    >
      {formatArenaPlacement(placement)}
    </div>
  );
}
