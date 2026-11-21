import { useMutation, useQuery } from "@tanstack/react-query";
import { CommandResultSchema, UserListSchema } from "#shared/api.ts";
import { queryClient, readApi, writeApi } from "#client/api.ts";
import {
  ErrorNotice,
  humanize,
  Loading,
  PageTitle,
  Status,
} from "#client/components.tsx";
import { useUser } from "#client/shell/user.ts";

export function HouseholdPage() {
  const user = useUser();
  const users = useQuery({
    queryKey: ["users"],
    queryFn: async () => readApi("/admin/users", UserListSchema),
  });
  const restrict = useMutation({
    mutationFn: async (input: {
      id: string;
      version: number;
      restricted: boolean;
    }) =>
      writeApi({
        actorId: user.id,
        path: `/admin/users/${encodeURIComponent(input.id)}`,
        body: { expectedVersion: input.version, restricted: input.restricted },
        schema: CommandResultSchema,
        method: "PATCH",
      }),
    onSuccess: async () =>
      queryClient.invalidateQueries({ queryKey: ["users"] }),
  });
  return (
    <>
      <PageTitle title="Household">
        <p>Choose who in your household can make new requests.</p>
      </PageTitle>
      {users.error !== null && <ErrorNotice error={users.error} />}
      {restrict.error !== null && <ErrorNotice error={restrict.error} />}
      <section className="panel">
        <h2>Household access</h2>
        {users.isPending && <Loading />}
        {users.data?.map((person) => (
          <div className="list-row" key={person.id}>
            <div>
              <strong>{person.displayName}</strong>
              <p className="muted">{humanize(person.role)}</p>
            </div>
            <Status
              value={person.restricted ? "requests_paused" : "requests_enabled"}
            />
            {person.role !== "owner" && (
              <button
                className="button subtle"
                disabled={restrict.isPending}
                onClick={() => {
                  restrict.mutate({
                    id: person.id,
                    version: person.version,
                    restricted: !person.restricted,
                  });
                }}
              >
                {person.restricted ? "Enable requests" : "Pause requests"}
              </button>
            )}
          </div>
        ))}
      </section>
    </>
  );
}
