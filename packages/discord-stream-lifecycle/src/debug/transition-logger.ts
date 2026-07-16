/**
 * The slice of XState's `InspectionEvent` this inspector actually reads. It is declared
 * structurally on purpose instead of importing xstate's `InspectionEvent`: the observer returned
 * by {@link createTransitionLogInspector} is handed to a **consumer's** `createActor({ inspect })`,
 * and if that consumer resolves to a different physical `xstate` install than this package (routine
 * in an isolated monorepo/CI dependency layout), typing the parameter as xstate's `InspectionEvent`
 * forces TS to deep-compare two copies of `InspectionEvent → AnyActorRef → AnyActorLogic`, which
 * overflows the type-instantiation-depth limit (TS2321). A shallow structural parameter keeps the
 * consumer's real `InspectionEvent` assignable here without triggering that deep comparison, so the
 * inspector plugs into any `xstate@5` actor regardless of which copy the consumer uses. XState
 * always calls the observer with the full event; these are the only fields the logger touches.
 */
type TransitionInspectionEvent =
  | {
      readonly type: "@xstate.snapshot" | "@xstate.microstep";
      readonly actorRef: { readonly sessionId: string };
      readonly snapshot: object;
      readonly event: { readonly type: string };
    }
  | {
      readonly type:
        | "@xstate.actor"
        | "@xstate.event"
        | "@xstate.action"
        | "@xstate.transition";
    };

/**
 * Minimal structured-logger surface the transition inspector writes to. Matches the
 * `SessionManagerLogger` shape in this package and streambot's `Logger`, so callers pass their
 * existing logger (optionally `.child("machine")`) with no adapter.
 */
export type TransitionLogSink = {
  info: (message: string, metadata?: Record<string, unknown>) => void;
};

export type CreateTransitionLogInspectorOptions = {
  /** Where transition lines are written. */
  readonly log: TransitionLogSink;
  /** Stable identifier for this actor tree — e.g. `guild:channel` (streambot) or a guild id. */
  readonly label?: string;
  /**
   * Optional projection of a machine's context into a few **scalar** fields to include on each
   * line. Receives the raw context as `unknown` (it is not statically typed at the inspection
   * boundary — the caller narrows it). Never return live objects (streams, timers, promises) —
   * they are logged verbatim and may be circular.
   */
  readonly projectContext?: (context: unknown) => Record<string, unknown>;
};

/** State values are `string` (atomic) or a nested object (compound/parallel). */
function formatStateValue(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** Best-effort read of the machine id off a snapshot, for disambiguating actors in the tree. */
function readMachineId(snapshot: object): string | undefined {
  if (!("machine" in snapshot)) return undefined;
  const machine: unknown = snapshot.machine;
  if (typeof machine !== "object" || machine === null || !("id" in machine)) {
    return undefined;
  }
  const id: unknown = machine.id;
  return typeof id === "string" ? id : undefined;
}

/**
 * Build an XState `inspect` observer that logs one structured line per state transition.
 *
 * Uses the `@xstate.microstep` inspection event (not `@xstate.snapshot`): microsteps expose
 * every individual transition **including transient `always` states** that never appear in
 * `subscribe()` / snapshots (e.g. streambot's `advance`/`skipped`/`failed`, and the raw-go-live
 * child's intermediate states). See https://stately.ai/docs/inspection.
 *
 * The observer receives events for the whole actor tree, so a single inspector attached at
 * `createActor(root, { inspect })` also captures invoked child machines. `fromPromise` actors
 * (joinVoice/runStream/…) have no state `value` and are skipped automatically.
 *
 * One inspector instance is scoped to one `createActor` call; its per-actor dedup state is
 * garbage-collected with the actor, so there is no cross-session accumulation.
 */
export function createTransitionLogInspector(
  options: CreateTransitionLogInspectorOptions,
): (inspectionEvent: TransitionInspectionEvent) => void {
  // Keyed by actor sessionId (unique per actor instance in the tree): last state value seen,
  // used to compute `from` and to suppress no-op self-transitions.
  const lastValue = new Map<string, string>();

  return (inspectionEvent) => {
    // Seed the initial state from the first snapshot: XState emits no microstep for the initial
    // state (and the actor isn't started yet at `@xstate.actor` time), so without this the first
    // transition would report `from: null` instead of the real starting state (e.g. `idle`). The
    // initial `@xstate.snapshot` fires before any microstep; later snapshots are already tracked.
    if (inspectionEvent.type === "@xstate.snapshot") {
      const sessionId = inspectionEvent.actorRef.sessionId;
      const snapshot = inspectionEvent.snapshot;
      if (!lastValue.has(sessionId) && "value" in snapshot) {
        lastValue.set(sessionId, formatStateValue(snapshot.value));
      }
      return;
    }
    if (inspectionEvent.type !== "@xstate.microstep") return;
    const snapshot = inspectionEvent.snapshot;
    if (!("value" in snapshot)) return; // not a state-machine actor (e.g. fromPromise)

    const sessionId = inspectionEvent.actorRef.sessionId;
    const to = formatStateValue(snapshot.value);
    const from = lastValue.get(sessionId) ?? null;
    const eventType = inspectionEvent.event.type;
    lastValue.set(sessionId, to);

    // Skip no-op self-transitions (state value unchanged): a *state* transition log. This also
    // elides the stateless desiredStream reconciler (value always empty), whose only job is to
    // forward events to the rawGoLive child that this same inspector already logs.
    if (from === to) return;

    try {
      const machineId = readMachineId(snapshot);
      const context =
        options.projectContext !== undefined && "context" in snapshot
          ? options.projectContext(snapshot.context)
          : {};
      // Spread `context` first so the fixed diagnostic fields (`label`, `machine`, `from`, `to`,
      // `event`) always win — a projectContext that returns a colliding key can't shadow them.
      options.log.info("state machine transition", {
        ...context,
        ...(options.label === undefined ? {} : { label: options.label }),
        ...(machineId === undefined ? {} : { machine: machineId }),
        from,
        to,
        event: eventType,
      });
    } catch (error) {
      // Observability must never break the state machine it observes.
      options.log.info("transition-logger failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
}
