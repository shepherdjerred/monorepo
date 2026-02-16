import { type Augment } from "@scout-for-lol/data";
import { renderAugment } from "@scout-for-lol/report/html/arena/augment.tsx";
import { filterDisplayAugments } from "@scout-for-lol/report/html/arena/utils.ts";

export function AugmentsDisplay({ augments }: { augments: Augment[] }) {
  const displayAugments = filterDisplayAugments(augments);
  if (displayAugments.length === 0) {
    return null;
  }

  const augmentPairs = [];
  for (let i = 0; i < displayAugments.length; i += 2) {
    augmentPairs.push(displayAugments.slice(i, i + 2));
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {augmentPairs.map((pair, pairIdx) => (
        <div key={pairIdx} style={{ display: "flex", gap: 12 }}>
          {pair.map((augment, augIdx) => (
            <div
              key={augIdx}
              style={{ display: "flex", fontSize: 22, opacity: 0.75 }}
            >
              {renderAugment(augment)}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
