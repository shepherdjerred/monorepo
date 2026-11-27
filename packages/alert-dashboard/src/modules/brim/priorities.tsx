import { useQuery } from "@tanstack/react-query";

import { brimQuery } from "./api.ts";
import {
  BrimPage,
  BrimQueryState,
  BrimSection,
  BrimTable,
  dateLabel,
} from "./presentation.tsx";
import { BrimPrioritiesSchema } from "./schema.ts";

function priorityRank(value: string): number {
  return value === "later" ? 5 : Number(value.slice(1));
}

export function BrimPrioritiesPage() {
  const query = useQuery(brimQuery("priorities", BrimPrioritiesSchema, 15_000));
  const data = query.data;
  return (
    <BrimPage title="Herdr priorities">
      <BrimSection title="Marked chats">
        {data === undefined ? (
          <BrimQueryState label="Herdr priorities" error={query.error} />
        ) : data.priorities.length === 0 ? (
          <p className="brim-message">No chats have been marked in Herdr.</p>
        ) : (
          <BrimTable
            label="Marked Herdr chats"
            columns={["Chat", "Device", "Priority", "Updated"]}
          >
            {data.priorities
              .toSorted((a, b) => {
                return (
                  priorityRank(a.priority) - priorityRank(b.priority) ||
                  b.updatedAt.localeCompare(a.updatedAt)
                );
              })
              .map((row) => (
                <tr key={`${row.coreId}/${row.terminalId}`}>
                  <th scope="row">{row.title ?? row.terminalId}</th>
                  <td>{row.machineName ?? row.coreId}</td>
                  <td>
                    <strong>
                      {row.priority === "later"
                        ? "Later"
                        : row.priority.toUpperCase()}
                    </strong>
                  </td>
                  <td>{dateLabel(row.updatedAt)}</td>
                </tr>
              ))}
          </BrimTable>
        )}
      </BrimSection>
    </BrimPage>
  );
}
