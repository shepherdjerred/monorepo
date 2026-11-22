import type { ReleaseList } from "#shared/api.ts";
import { humanize } from "#client/components.tsx";
import { classNames } from "#client/ui/class-names.ts";
import { Badge } from "#client/ui/feedback.tsx";
import { FactList, TechnicalDetails } from "#client/ui/record.tsx";
import styles from "./evidence.module.css";

const cx = classNames(styles);

type Release = ReleaseList[number];

/** Whether Media accepted the release, as the badge beside its name. */
export function ReleaseVerdict({ release }: { release: Release }) {
  return release.evaluation.accepted ? (
    <Badge tone="ok">Accepted</Badge>
  ) : (
    <Badge tone="warn">Rejected</Badge>
  );
}

/**
 * How Media judged one release: the verdict, what it scored, the reasons it
 * gave, and the exact record behind them.
 */
export function ReleaseEvidence({ release }: { release: Release }) {
  const { evaluation, attributes } = release;
  return (
    <div className={cx("evidence")}>
      <FactList
        facts={[
          { term: "Decision", detail: <ReleaseVerdict release={release} /> },
          { term: "Quality", detail: attributes.quality },
          { term: "Score", detail: String(evaluation.score) },
          { term: "Identity", detail: humanize(attributes.identityConfidence) },
        ]}
      />
      {evaluation.reasons.length > 0 && (
        <div>
          <p className={cx("reasonsTitle")}>Reasons recorded</p>
          <ul className={cx("reasons")}>
            {evaluation.reasons.map((reason) => (
              <li key={reason}>{humanize(reason)}</li>
            ))}
          </ul>
        </div>
      )}
      <TechnicalDetails value={{ evaluation, attributes }} />
    </div>
  );
}
