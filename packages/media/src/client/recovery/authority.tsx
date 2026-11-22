import type { z } from "zod";
import type { RecoveryListSchema } from "#shared/recovery.ts";
import {
  AUTHORITY_STATE_COPY,
  AUTOMATION_MODE_COPY,
} from "#client/presentation/recovery.ts";
import { DataList, DataRow } from "#client/ui/data-list.tsx";
import { Badge } from "#client/ui/feedback.tsx";
import { Panel } from "#client/ui/panel.tsx";
import { Plain } from "./parts.tsx";

type Authority = NonNullable<z.infer<typeof RecoveryListSchema>["authority"]>;

/** Whether the restore left Media allowed to act on its own, read only. */
export function AuthorityPanel({ authority }: { authority: Authority }) {
  const mode = AUTOMATION_MODE_COPY[authority.mode];
  const writer = AUTHORITY_STATE_COPY[authority.writerState];
  const storage = AUTHORITY_STATE_COPY[authority.storageState];
  return (
    <Panel
      title="Automation authority"
      description="What Media may do by itself after the restore. A household review does not change any of this."
    >
      <DataList label="Automation authority">
        <DataRow
          title="Runtime"
          detail={mode.note}
          status={<Badge tone={mode.tone}>{mode.label}</Badge>}
        />
        <DataRow
          title="Ownership"
          status={
            authority.ownershipConfirmed ? (
              <Badge tone="ok">Confirmed</Badge>
            ) : (
              <Badge tone="warn">Not confirmed</Badge>
            )
          }
        />
        <DataRow
          title="Legacy writer authority"
          status={<Badge tone={writer.tone}>{writer.label}</Badge>}
        />
        <DataRow
          title="Storage authority"
          status={<Badge tone={storage.tone}>{storage.label}</Badge>}
        />
      </DataList>
      <Plain>
        For revoked, stale or missing authority, the operator must resolve
        legacy writers or storage changes and obtain fresh observations.
        Resuming automation requires a separately reviewed ownership handoff.
      </Plain>
      <Plain>
        Household review releases only the selected recovery holds. It does not
        renew writer or storage authority or activate automation.
      </Plain>
    </Panel>
  );
}
