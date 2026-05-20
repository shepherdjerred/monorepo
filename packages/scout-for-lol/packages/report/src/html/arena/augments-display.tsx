import { type Augment } from "@scout-for-lol/data";
import { AugmentRow } from "#src/html/arena/augment.tsx";
import { filterDisplayAugments } from "#src/html/arena/utils.ts";

export function AugmentsDisplay({ augments }: { augments: Augment[] }) {
  const displayAugments = filterDisplayAugments(augments);
  if (displayAugments.length === 0) {
    return null;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {displayAugments.map((augment, idx) => (
        <AugmentRow key={idx} augment={augment} />
      ))}
    </div>
  );
}
