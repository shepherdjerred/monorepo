import { useQuery } from "@tanstack/react-query";
import type { MediaUser } from "#shared/contract.ts";
import {
  CapacityViewSchema,
  type CapacityView,
  type CapacityRoleView,
} from "#shared/capacity/view.ts";
import { readApi } from "#client/api.ts";
import { dateLabel } from "#client/components.tsx";
import { Button } from "#client/ui/button.tsx";
import { classNames } from "#client/ui/class-names.ts";
import { DataList, DataRow } from "#client/ui/data-list.tsx";
import { Badge, Callout, LoadError } from "#client/ui/feedback.tsx";
import { Panel, SkeletonRows } from "#client/ui/panel.tsx";
import type { StatusTone } from "#client/status/tone.ts";
import { capacityBytes } from "./format.ts";
import { capacityReasons, capacityStates } from "./presentation.ts";
import styles from "./panel.module.css";

const cx = classNames(styles);

/** How worrying each state of a measurement is. */
const STATE_TONES = {
  current: "ok",
  missing: "warn",
  unavailable: "warn",
  future: "warn",
  old_epoch: "warn",
  root_changed: "warn",
  stale: "warn",
} as const satisfies Record<CapacityRoleView["state"], StatusTone>;

export function CapacityPanel({ user }: { user: MediaUser }) {
  return user.role !== "owner" || user.restricted ? null : (
    <OwnerCapacityPanel userId={user.id} />
  );
}

function OwnerCapacityPanel({ userId }: { userId: string }) {
  const result = useQuery({
    queryKey: ["capacity", userId],
    queryFn: () => readApi("/admin/capacity", CapacityViewSchema),
    refetchInterval: 30_000,
  });
  return (
    <Panel
      title="Storage capacity"
      description="Filesystem measurements are informational. They do not reserve space or authorize writes. Movies and TV may share storage; their capacities should not be added together."
    >
      {result.isPending && (
        <SkeletonRows label="Loading storage capacity" rows={2} />
      )}
      {result.error !== null && (
        <LoadError
          what="Storage capacity"
          error={result.error}
          retry={() => {
            void result.refetch();
          }}
        />
      )}
      {result.error === null && result.data !== undefined && (
        <CapacityMeasurements view={result.data} />
      )}
      <div>
        <Button
          disabled={result.isFetching}
          onClick={() => {
            void result.refetch();
          }}
        >
          Refresh view
        </Button>
      </div>
    </Panel>
  );
}

export function CapacityMeasurements({ view }: { view: CapacityView }) {
  return (
    <>
      {!view.samplingEnabled && (
        <Callout tone="neutral">
          Capacity collection is off. Existing measurements are shown only while
          their storage checks and sample times remain valid.
        </Callout>
      )}
      <DataList label="Storage by library">
        {view.roles.map((role) => (
          <CapacityMeasurement key={role.role} value={role} />
        ))}
      </DataList>
      <p className={cx("asOf")}>Status checked {dateLabel(view.asOf)}.</p>
    </>
  );
}

function CapacityMeasurement({ value }: { value: CapacityRoleView }) {
  return (
    <DataRow
      title={value.role === "movies" ? "Movies" : "TV"}
      status={
        <Badge tone={STATE_TONES[value.state]}>
          {capacityStates[value.state]}
        </Badge>
      }
      detail={
        <>
          {value.reason !== null && <p>{capacityReasons[value.reason]}</p>}
          {value.sampledAt !== null && (
            <p>Measured {dateLabel(value.sampledAt)}.</p>
          )}
        </>
      }
    >
      {value.state === "current" && <CurrentBytes value={value} />}
    </DataRow>
  );
}

function CurrentBytes({ value }: { value: CapacityRoleView }) {
  if (value.totalBytes === null || value.availableBytes === null)
    throw new Error("Current capacity requires measured bytes");
  return (
    <dl className={cx("facts")}>
      <div>
        <dt>Available</dt>
        <dd>{capacityBytes(value.availableBytes)}</dd>
      </div>
      <div>
        <dt>Total filesystem size</dt>
        <dd>{capacityBytes(value.totalBytes)}</dd>
      </div>
    </dl>
  );
}
