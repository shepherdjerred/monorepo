import { useQuery } from "@tanstack/react-query";
import type { MediaUser } from "#shared/contract.ts";
import {
  CapacityViewSchema,
  type CapacityView,
  type CapacityRoleView,
} from "#shared/capacity/view.ts";
import { readApi } from "#client/api.ts";
import {
  dateLabel,
  ErrorNotice,
  Loading,
  Notice,
} from "#client/components.tsx";
import { capacityBytes } from "./format.ts";
import { capacityReasons, capacityStates } from "./presentation.ts";
import "./panel.css";

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
    <section className="panel" aria-labelledby="storage-capacity-title">
      <h2 id="storage-capacity-title">Storage capacity</h2>
      <p>
        Filesystem measurements are informational. They do not reserve space or
        authorize writes. Movies and TV may share storage; their capacities
        should not be added together.
      </p>
      {result.isPending && <Loading />}
      {result.error !== null && <ErrorNotice error={result.error} />}
      {result.error === null && result.data !== undefined && (
        <CapacityMeasurements view={result.data} />
      )}
      <button
        className="button subtle"
        disabled={result.isFetching}
        onClick={() => {
          void result.refetch();
        }}
      >
        Refresh view
      </button>
    </section>
  );
}

export function CapacityMeasurements({ view }: { view: CapacityView }) {
  return (
    <>
      {!view.samplingEnabled && (
        <Notice>
          Capacity collection is off. Existing measurements are shown only while
          their storage checks and sample times remain valid.
        </Notice>
      )}
      <p className="helper">Status checked {dateLabel(view.asOf)}.</p>
      <div className="detail-columns">
        {view.roles.map((role) => (
          <CapacityMeasurement key={role.role} value={role} />
        ))}
      </div>
    </>
  );
}

function CapacityMeasurement({ value }: { value: CapacityRoleView }) {
  return (
    <article>
      <h3>{value.role === "movies" ? "Movies" : "TV"}</h3>
      <p>
        <strong>{capacityStates[value.state]}</strong>
      </p>
      {value.reason !== null && <p>{capacityReasons[value.reason]}</p>}
      {value.state === "current" && <CurrentBytes value={value} />}
      {value.sampledAt !== null && (
        <p className="helper">Measured {dateLabel(value.sampledAt)}.</p>
      )}
    </article>
  );
}

function CurrentBytes({ value }: { value: CapacityRoleView }) {
  if (value.totalBytes === null || value.availableBytes === null)
    throw new Error("Current capacity requires measured bytes");
  return (
    <dl className="facts capacity-facts">
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
