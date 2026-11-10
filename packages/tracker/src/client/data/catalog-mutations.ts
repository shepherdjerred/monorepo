import { api, queryClient, type BootstrapData } from "./api.ts";
import { bootstrapKey, listsKey, optimistic, type Outcome } from "./cache.ts";
import { currentActor } from "./identity.ts";
import { workspace } from "./mutations.ts";
import { notify, notifyError } from "#client/ui/toast.tsx";

type Label = BootstrapData["labels"][number];
type Project = BootstrapData["projects"][number];
type State = BootstrapData["states"][number];

function patchWorkspace(change: (data: BootstrapData) => BootstrapData) {
  queryClient.setQueryData<BootstrapData>(bootstrapKey, (data) =>
    data === undefined ? data : change(data),
  );
}

function teamId(teamKey: string) {
  const team = workspace().teams.find(({ key }) => key === teamKey);
  if (team === undefined) {
    throw new Error(`Unknown team ${teamKey}`);
  }
  return team.id;
}

/** Catalog changes are the only mutations that refetch the workspace. */
function settle() {
  void queryClient.invalidateQueries({ queryKey: bootstrapKey });
}

function finish<T>(outcome: Outcome<T>, done: string, failed: string) {
  if (outcome.ok) {
    notify(done);
  } else {
    const reason =
      outcome.error instanceof Error
        ? outcome.error.message
        : "Something went wrong";
    notifyError(`${failed}: ${reason}`);
  }
  return outcome;
}

const temporaryId = () => `optimistic-${crypto.randomUUID()}`;

export async function createLabel(input: {
  teamKey: string;
  name: string;
  color: string;
}) {
  const label: Label = {
    id: temporaryId(),
    teamId: teamId(input.teamKey),
    name: input.name,
    color: input.color,
  };
  const outcome = await optimistic({
    apply: () => {
      patchWorkspace((data) => ({ ...data, labels: [...data.labels, label] }));
      return () => {
        patchWorkspace((data) => ({
          ...data,
          labels: data.labels.filter(({ id }) => id !== label.id),
        }));
      };
    },
    run: () => api.labels.create.mutate({ actor: currentActor(), ...input }),
    settle,
  });
  return finish(outcome, "Label created", "Label not created");
}

export async function deleteLabel(teamKey: string, label: Label) {
  const outcome = await optimistic({
    apply: () => {
      const index = workspace().labels.findIndex(({ id }) => id === label.id);
      patchWorkspace((data) => ({
        ...data,
        labels: data.labels.filter(({ id }) => id !== label.id),
      }));
      return () => {
        patchWorkspace((data) =>
          data.labels.some(({ id }) => id === label.id)
            ? data
            : {
                ...data,
                labels: [
                  ...data.labels.slice(0, index),
                  label,
                  ...data.labels.slice(index),
                ],
              },
        );
      };
    },
    run: () =>
      api.labels.delete.mutate({
        actor: currentActor(),
        teamKey,
        name: label.name,
      }),
    settle: () => {
      settle();
      // Issues carried the label too.
      void queryClient.invalidateQueries({ queryKey: listsKey });
      void queryClient.invalidateQueries({ queryKey: ["issue"] });
    },
  });
  return finish(outcome, "Label deleted", "Label not deleted");
}

export async function createProject(input: {
  slug: string;
  name: string;
  color: string;
}) {
  const project: Project = {
    id: temporaryId(),
    description: "",
    archivedAt: null,
    ...input,
  };
  const outcome = await optimistic({
    apply: () => {
      patchWorkspace((data) => ({
        ...data,
        projects: [...data.projects, project],
      }));
      return () => {
        patchWorkspace((data) => ({
          ...data,
          projects: data.projects.filter(({ id }) => id !== project.id),
        }));
      };
    },
    run: () => api.projects.create.mutate({ actor: currentActor(), ...input }),
    settle,
  });
  return finish(outcome, "Project created", "Project not created");
}

export async function archiveProject(project: Project) {
  const setArchived = (archivedAt: string | null) => {
    patchWorkspace((data) => ({
      ...data,
      projects: data.projects.map((item) =>
        item.id === project.id ? { ...item, archivedAt } : item,
      ),
    }));
  };
  const outcome = await optimistic({
    apply: () => {
      setArchived(new Date().toISOString());
      return () => {
        setArchived(project.archivedAt);
      };
    },
    run: () =>
      api.projects.archive.mutate({
        actor: currentActor(),
        slug: project.slug,
      }),
    settle,
  });
  return finish(outcome, "Project archived", "Project not archived");
}

export async function createState(input: {
  teamKey: string;
  name: string;
  type: State["type"];
  color: string;
  position: number;
}) {
  const { teamKey, ...fields } = input;
  const state: State = {
    id: temporaryId(),
    teamId: teamId(teamKey),
    ...fields,
  };
  const outcome = await optimistic({
    apply: () => {
      patchWorkspace((data) => ({ ...data, states: [...data.states, state] }));
      return () => {
        patchWorkspace((data) => ({
          ...data,
          states: data.states.filter(({ id }) => id !== state.id),
        }));
      };
    },
    run: () => api.states.create.mutate({ actor: currentActor(), ...input }),
    settle,
  });
  return finish(outcome, "State created", "State not created");
}
