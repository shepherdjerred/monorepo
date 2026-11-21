import { useMutation, useQuery } from "@tanstack/react-query";
import { CommandResultSchema, UserListSchema } from "#shared/api.ts";
import { queryClient, readApi, writeApi } from "#client/api.ts";
import { PageTitle } from "#client/components.tsx";
import { useUser } from "#client/shell/user.ts";
import { Button } from "#client/ui/button.tsx";
import { DataList, DataRow } from "#client/ui/data-list.tsx";
import { Badge, Callout, LoadError } from "#client/ui/feedback.tsx";
import { useSavedNotes } from "#client/ui/form.tsx";
import { EmptyNote, Panel, SkeletonRows } from "#client/ui/panel.tsx";

type RequestsChange = {
  id: string;
  name: string;
  version: number;
  restricted: boolean;
};

export function HouseholdPage() {
  const user = useUser();
  const users = useQuery({
    queryKey: ["users"],
    queryFn: async () => readApi("/admin/users", UserListSchema),
  });
  const notes = useSavedNotes();
  const restrict = useMutation({
    mutationFn: async (input: RequestsChange) =>
      writeApi({
        actorId: user.id,
        path: `/admin/users/${encodeURIComponent(input.id)}`,
        body: { expectedVersion: input.version, restricted: input.restricted },
        schema: CommandResultSchema,
        method: "PATCH",
      }),
    onSuccess: async (_result, input) => {
      notes.saved(
        input.id,
        input.restricted
          ? `Requests paused for ${input.name}.`
          : `Requests resumed for ${input.name}.`,
      );
      return queryClient.invalidateQueries({ queryKey: ["users"] });
    },
  });
  return (
    <>
      <PageTitle title="Household">
        <p>Choose who in your household can make new requests.</p>
      </PageTitle>
      <Panel
        title="Members"
        description="Someone whose requests are paused sees a notice and cannot ask for anything new."
      >
        {users.isPending && <SkeletonRows label="Loading members" rows={4} />}
        {users.error !== null && (
          <LoadError
            what="Members"
            error={users.error}
            retry={() => {
              void users.refetch();
            }}
          />
        )}
        {users.data?.length === 0 && (
          <EmptyNote>
            No one has signed in yet. People appear here the first time they
            sign in with Plex.
          </EmptyNote>
        )}
        {users.data !== undefined && users.data.length > 0 && (
          <DataList label="Members">
            {users.data.map((person) => {
              const changing =
                restrict.isPending && restrict.variables.id === person.id;
              return (
                <DataRow
                  key={person.id}
                  title={person.displayName}
                  detail={
                    person.role === "owner"
                      ? "Owner. The owner can always make requests."
                      : "Member"
                  }
                  note={notes.note(person.id)}
                  status={
                    person.restricted ? (
                      <Badge tone="warn">Requests paused</Badge>
                    ) : (
                      <Badge tone="ok">Requests on</Badge>
                    )
                  }
                  actions={
                    person.role !== "owner" && (
                      <Button
                        busy={changing}
                        disabled={restrict.isPending}
                        onClick={() => {
                          notes.edited(person.id);
                          restrict.mutate({
                            id: person.id,
                            name: person.displayName,
                            version: person.version,
                            restricted: !person.restricted,
                          });
                        }}
                      >
                        {person.restricted
                          ? "Resume requests"
                          : "Pause requests"}
                      </Button>
                    )
                  }
                >
                  {restrict.error !== null &&
                    restrict.variables.id === person.id && (
                      <Callout tone="danger">
                        {person.displayName} was not changed.{" "}
                        {restrict.error.message}
                      </Callout>
                    )}
                </DataRow>
              );
            })}
          </DataList>
        )}
      </Panel>
    </>
  );
}
