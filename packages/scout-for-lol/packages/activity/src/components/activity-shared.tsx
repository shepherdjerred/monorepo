import type { CustomNightSnapshot } from "@scout-for-lol/data";

export type ActivityControlProps = {
  snapshot: CustomNightSnapshot;
  viewerId: string;
  onSnapshot: (snapshot: CustomNightSnapshot) => void;
  onError: (error: unknown) => void;
};

export type CurrentGame = NonNullable<CustomNightSnapshot["currentGame"]>;

export type GameControlProps = ActivityControlProps & {
  game: CurrentGame;
};

export function revision(snapshot: CustomNightSnapshot) {
  return { nightId: snapshot.id, expectedRevision: snapshot.revision };
}

export function StatePill({ state }: { state: string }) {
  return <span className="state-pill">{state.replaceAll("_", " ")}</span>;
}

export async function runSnapshotAction(
  action: Promise<CustomNightSnapshot>,
  callbacks: Pick<ActivityControlProps, "onSnapshot" | "onError">,
): Promise<void> {
  try {
    callbacks.onSnapshot(await action);
  } catch (error) {
    callbacks.onError(error);
  }
}
