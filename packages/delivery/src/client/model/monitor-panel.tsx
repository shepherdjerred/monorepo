import type { MonitorStatus } from "#shared/model/contract.ts";
import { Status } from "#client/components/status.tsx";
import { RelativeTime } from "#client/components/time.tsx";
import { DeploymentLink } from "./selection-facts.tsx";
import { formatEvidence } from "./environment-status.ts";
import {
  firingAlarms,
  monitorEvidence,
  monitorPolicyLabel,
  type EvidenceRow,
} from "./view.ts";
import { Fact, Facts } from "#client/components/facts.tsx";

function EvidenceTable({ rows }: { rows: EvidenceRow[] }) {
  return (
    <div className="table-scroll">
      <table>
        <caption className="visually-hidden">
          Evidence against threshold
        </caption>
        <thead>
          <tr>
            <th scope="col">Evidence</th>
            <th scope="col">Observed of threshold</th>
            <th scope="col">Result</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <th scope="row" className="mono">
                {row.key}
              </th>
              <td>
                <span className="evidence-meter">
                  <span>
                    {row.value === null ? "none" : formatEvidence(row.value)} of{" "}
                    {formatEvidence(row.threshold)}
                  </span>
                  <meter
                    min={0}
                    max={row.threshold}
                    value={Math.min(row.value ?? 0, row.threshold)}
                    aria-label={`${row.key} progress`}
                  />
                </span>
              </td>
              <td>{row.met ? "Met" : "Below threshold"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type FiringAlarm = ReturnType<typeof firingAlarms>["counted"][number];

function AlarmList({ alarms }: { alarms: FiringAlarm[] }) {
  return (
    <ul className="alarms">
      {alarms.map((alarm) => (
        <li key={`${alarm.alertname}:${JSON.stringify(alarm.labels)}`}>
          <strong>{alarm.alertname}</strong>{" "}
          <span className="badge">{alarm.severity}</span> · firing since{" "}
          <RelativeTime value={alarm.activeAt} />
          <br />
          <small className="mono">
            {Object.entries(alarm.labels)
              .map(([name, value]) => `${name}=${value}`)
              .join(" ")}
          </small>
        </li>
      ))}
    </ul>
  );
}

function Alarms({ status }: { status: MonitorStatus }) {
  const { counted, preExisting } = firingAlarms(status);
  return (
    <>
      {counted.length === 0 ? (
        <p className="empty">No counted alarm is firing.</p>
      ) : (
        <AlarmList alarms={counted} />
      )}
      {preExisting.length > 0 && (
        <>
          <p>
            Already firing before this deployment was claimed, so not counted
            against it:
          </p>
          <AlarmList alarms={preExisting} />
        </>
      )}
    </>
  );
}

function Outcome({ status }: { status: MonitorStatus }) {
  if (status.state === "alarmed" && status.alarmedAt !== null)
    return (
      <p className="notice error">
        An alarm fired <RelativeTime value={status.alarmedAt} />.{" "}
        {status.policy === "automatic"
          ? "Delivery requests a rollback to the last settled selection when a candidate is eligible, and holds the environment otherwise."
          : "The environment is held for an operator."}
      </p>
    );
  if (status.state === "settled" && status.settledAt !== null)
    return (
      <p className="notice success">
        Settled <RelativeTime value={status.settledAt} />: every evidence count
        met its threshold with no alarm.
      </p>
    );
  return null;
}

/** The accepted deployment's monitor: state, policy, evidence and alarms (4.19). */
export function MonitorPanel({ status }: { status: MonitorStatus }) {
  const latest = status.latestObservation;
  return (
    <>
      <Facts>
        <Fact label="State">
          <Status value={status.state} />
        </Fact>
        <Fact label="Policy">{monitorPolicyLabel(status.policy)}</Fact>
        <Fact label="Latest observation">
          {latest === null ? (
            "None yet"
          ) : (
            <>
              <RelativeTime value={latest.observedAt} /> · window{" "}
              {latest.window}
            </>
          )}
        </Fact>
        <Fact label="Watching">
          {status.deploymentId === null ? (
            "No accepted deployment"
          ) : (
            <DeploymentLink id={status.deploymentId} short />
          )}
        </Fact>
      </Facts>
      <Outcome status={status} />
      {status.monitor === null ? (
        <p className="muted">
          {status.deploymentId === null
            ? "No monitor is declared, and nothing has been accepted here yet."
            : "No monitor is declared, so the accepted selection settled on acceptance."}
        </p>
      ) : (
        <>
          <h3>Evidence</h3>
          <EvidenceTable rows={monitorEvidence(status)} />
          <h3>Firing alarms</h3>
          <Alarms status={status} />
        </>
      )}
    </>
  );
}
