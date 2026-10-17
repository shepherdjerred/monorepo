import { Link } from "react-router";
import type { z } from "zod";
import type { NativeLifecycleDetailSchema } from "#shared/native-recovery/lifecycle.ts";
import { humanize } from "#client/components.tsx";

type Continuation = z.infer<
  typeof NativeLifecycleDetailSchema
>["continuations"][number];
export function QuarantineContinuations({ items }: { items: Continuation[] }) {
  if (items.length === 0) return null;
  return (
    <section className="panel">
      <h2>Quarantine restoration</h2>
      {items.map((item) => (
        <article key={item.id}>
          <h3>{restorationTitle(item)}</h3>
          <p>{restorationDescription(item)}</p>
          <ul>
            {item.media.map((media) => (
              <li key={media.id}>
                <Link to={`/media/${media.id}`}>{media.title}</Link> ·{" "}
                {humanize(media.availability)}
              </li>
            ))}
          </ul>
        </article>
      ))}
      <p>
        <Link to="/recovery">Review current household intent</Link>. A shared
        file stays protected until every covered leaf has current positive
        authority. Negative choices never authorize deletion.
      </p>
    </section>
  );
}

function restorationTitle(item: Continuation) {
  if (mixedDemand(item)) return "Mixed demand · restoration protected";
  if (item.state === "protected") return "Restoration protected";
  if (item.state === "pending")
    return item.currentPositiveMediaIds.length === 0
      ? "Held in quarantine"
      : "Awaiting restore coordination";
  if (item.state === "restoring") return "Restoration in progress";
  return item.media.every((media) => media.availability === "available")
    ? "Playback verified in Plex"
    : "Files restored · Plex verification pending";
}
function restorationDescription(item: Continuation) {
  if (mixedDemand(item))
    return "Some covered titles have current positive demand and others do not. This shared file cannot be restored until every covered leaf has current authority. Negative choices are preserved.";
  if (item.state === "protected")
    return "Current authority or physical evidence did not allow restoration. The files remain protected; review current household intent and operator diagnostics before retrying.";
  if (item.state === "pending")
    return item.currentPositiveMediaIds.length === 0
      ? "Physical ownership is recorded. No restore has been authorized by current positive demand."
      : "Current positive demand is recorded. Restoration must still be authorized before files move.";
  if (item.state === "restoring")
    return "A current restore command is checking and moving the exact quarantined files. Playback is not yet verified.";
  return item.media.every((media) => media.availability === "available")
    ? "Plex readback verified all covered titles after restoration. Household recovery holds remain independent."
    : "The filesystem continuation completed. Covered titles remain unavailable until exact Plex readback succeeds.";
}

function mixedDemand(item: Continuation) {
  return (
    item.state !== "restored" &&
    item.currentPositiveMediaIds.length > 0 &&
    item.currentPositiveMediaIds.length < item.media.length
  );
}
