package com.shepherdjerred.thestorm.rwfbots.app;

import com.shepherdjerred.thestorm.core.compute.ComputePool;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavGraph;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Percept;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Perception;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.PerceptionState;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.SenseContext;
import com.shepherdjerred.thestorm.rwfbots.domain.tactics.Planner;
import com.shepherdjerred.thestorm.rwfbots.domain.tactics.Situation;
import com.shepherdjerred.thestorm.rwfbots.domain.tactics.Tactics;
import com.shepherdjerred.thestorm.rwfbots.domain.tactics.TacticsContext;
import com.shepherdjerred.thestorm.rwfbots.domain.tactics.TacticsState;
import com.shepherdjerred.thestorm.rwfbots.domain.tactics.Thought;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Blackboard;
import com.shepherdjerred.thestorm.rwfbots.domain.team.RetakeAdmission;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Role;
import com.shepherdjerred.thestorm.rwfbots.domain.team.SharedSighting;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Slot;
import com.shepherdjerred.thestorm.rwfbots.domain.team.SlotFit;
import com.shepherdjerred.thestorm.rwfbots.domain.team.TeamBrain;
import com.shepherdjerred.thestorm.rwfbots.domain.team.TeamPlan;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Decision;
import com.shepherdjerred.thestorm.rwfbots.domain.world.TeamId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.SplittableRandom;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.LongSupplier;
import java.util.stream.IntStream;
import org.jspecify.annotations.Nullable;

/**
 * The bots' think layers off the main thread. Each tick the main thread {@linkplain #publish
 * publishes} an immutable {@link WorldSnapshot} into a one-slot mailbox (a newer snapshot replaces
 * one not yet consumed) and, if no think job is running, submits one to the compute pool. The job
 * takes the newest snapshot, runs perception, the team step and tactics for the bots due this
 * cycle, and publishes a {@link DecisionBoard} into a second one-slot mailbox that the main thread
 * reads with one volatile read.
 *
 * <p>Only one cycle runs at a time. Its bounded parallel stages return proposals; ordered barriers
 * alone commit bot and team state. No worker waits for another task on the shared compute pool. The
 * main thread only registers bots, bumps life epochs and asks for rethinks through concurrent maps.
 * Randomness is a fresh {@link SplittableRandom} per bot per job, seeded from the match seed, the
 * bot and the tick, so a replay with the same snapshots makes the same decisions.
 */
public final class ThinkLoop {

  /** A layer that has never run. */
  static final long NEVER = Long.MIN_VALUE;

  /** Mixed into a bot's seed for its match-long route noise and quirk timing. */
  static final long ROUTE_SALT = 0x5EED_0F_A11L;

  private final ComputePool compute;
  private final ThinkRates rates;
  private final Governor governor;
  private final TraceSink traces;
  private final LongSupplier nanoClock;
  private final AtomicReference<@Nullable WorldSnapshot> inbox = new AtomicReference<>();
  private final AtomicReference<DecisionBoard> outbox = new AtomicReference<>(DecisionBoard.EMPTY);
  private final AtomicBoolean running = new AtomicBoolean();
  private final AtomicInteger generation = new AtomicInteger();
  private final ConcurrentHashMap<CombatantId, BotProfile> profiles = new ConcurrentHashMap<>();
  private final ConcurrentHashMap<CombatantId, Integer> epochs = new ConcurrentHashMap<>();
  private final Set<CombatantId> replans = ConcurrentHashMap.newKeySet();
  private final ConcurrentHashMap<CombatantId, TeamReport> reports = new ConcurrentHashMap<>();
  private final ConcurrentHashMap<CombatantId, TeamReport> deliveredReports =
      new ConcurrentHashMap<>();
  private volatile boolean composedCommunication;
  private final ConcurrentHashMap<TeamId, SensorEnvelope> sensors = new ConcurrentHashMap<>();
  private final ThinkStats stats = new ThinkStats();
  private final Worker worker;
  private final AtomicReference<@Nullable Failure> failure = new AtomicReference<>();
  private volatile int failedGeneration = -1;
  private volatile CompletableFuture<Void> completion = CompletableFuture.completedFuture(null);
  private volatile @Nullable Match match;
  private volatile boolean closed;

  /**
   * What the loop is built from.
   *
   * @param compute the pool think jobs run on
   * @param rates how often each layer runs
   * @param governor whose level scales the rates
   * @param traces where decision traces go
   * @param nanoClock a monotonic nanosecond clock for timing jobs
   */
  public record Parts(
      ComputePool compute,
      ThinkRates rates,
      Governor governor,
      TraceSink traces,
      LongSupplier nanoClock) {}

  public ThinkLoop(Parts parts) {
    this.compute = parts.compute();
    this.rates = parts.rates();
    this.governor = parts.governor();
    this.traces = parts.traces();
    this.nanoClock = parts.nanoClock();
    this.worker = new Worker();
  }

  /** The match the loop thinks for. */
  private record Match(
      int generation,
      long seed,
      long navigationRevision,
      NavArtifact nav,
      List<com.shepherdjerred.thestorm.rwfbots.domain.perception.SightCloud> clouds) {}

  private record Failure(int generation, RuntimeException problem) {}

  private record SensorEnvelope(
      int generation, com.shepherdjerred.thestorm.rwfbots.domain.team.SensorClue clue) {}

  // ---- main thread -----------------------------------------------------------------------------

  /** Starts thinking for a match on {@code nav}; forgets every bot of the previous match. */
  public void beginMatch(long seed, NavArtifact nav) {
    sensors.clear();
    reports.clear();
    deliveredReports.clear();
    profiles.clear();
    epochs.clear();
    replans.clear();
    failure.set(null);
    inbox.set(null);
    outbox.set(DecisionBoard.EMPTY);
    match = new Match(generation.incrementAndGet(), seed, 0, nav, List.of());
  }

  /** Publishes fresh door occlusion, preserving plans, memory, life epochs and random seeds. */
  public void observedNavigation(NavArtifact nav) {
    var current = match;
    if (current == null || !current.nav().graph().equals(nav.graph())) {
      throw new IllegalArgumentException("navigation observation is not from the current match");
    }
    match =
        new Match(
            current.generation(),
            current.seed(),
            current.navigationRevision() + 1,
            nav,
            current.clouds());
  }

  /** Main-thread capture of smoke geometry; workers receive only immutable values. */
  public void observedSmoke(
      List<com.shepherdjerred.thestorm.rwfbots.domain.perception.SightCloud> clouds) {
    var current = match;
    var copy = List.copyOf(clouds);
    if (current != null && !current.clouds().equals(copy)) {
      match =
          new Match(
              current.generation(),
              current.seed(),
              current.navigationRevision() + 1,
              current.nav(),
              copy);
    }
  }

  /** Stops thinking; publishes are ignored until the next match begins. */
  public void endMatch() {
    sensors.clear();
    reports.clear();
    deliveredReports.clear();
    match = null;
    profiles.clear();
    epochs.clear();
    replans.clear();
    inbox.set(null);
    outbox.set(DecisionBoard.EMPTY);
    if (!running.get()) worker.retire();
  }

  public boolean inMatch() {
    return match != null;
  }

  /**
   * Cosmetic chat off uses ordinary delayed coordination; enabled calls share only on completion.
   */
  public void composedCommunication(boolean enabled) {
    composedCommunication = enabled;
    if (!enabled) {
      reports.clear();
      deliveredReports.clear();
    }
  }

  public List<TeamReport> drainReports() {
    var ready =
        reports.values().stream()
            .sorted(Comparator.comparing(report -> report.sighting().reporter()))
            .toList();
    ready.forEach(report -> reports.remove(report.sighting().reporter(), report));
    return ready;
  }

  /**
   * Called only after the line was successfully sent; worker ownership of team state is retained.
   */
  public void delivered(TeamReport report) {
    if (composedCommunication && profiles.containsKey(report.sighting().reporter()))
      deliveredReports.put(report.sighting().reporter(), report);
  }

  public void sensor(TeamId team, com.shepherdjerred.thestorm.rwfbots.domain.team.SensorClue clue) {
    var current = match;
    if (current != null) sensors.put(team, new SensorEnvelope(current.generation(), clue));
  }

  public void register(BotProfile profile) {
    profiles.put(profile.id(), profile);
    epochs.putIfAbsent(profile.id(), 0);
  }

  public void unregister(CombatantId bot) {
    profiles.remove(bot);
    epochs.remove(bot);
    replans.remove(bot);
  }

  public Optional<BotProfile> profile(CombatantId bot) {
    return Optional.ofNullable(profiles.get(bot));
  }

  public List<BotProfile> profiles() {
    return profiles.values().stream().sorted(Comparator.comparingInt(BotProfile::slot)).toList();
  }

  /** The bot started a new life (died, respawned, was teleported or rewound). */
  public void bumpEpoch(CombatantId bot) {
    epochs.computeIfPresent(bot, (id, epoch) -> epoch + 1);
    replans.add(bot);
  }

  public int epoch(CombatantId bot) {
    return epochs.getOrDefault(bot, 0);
  }

  /** Asks the next job to rethink {@code bot} whether or not its tactics are due. */
  public void requestReplan(CombatantId bot) {
    replans.add(bot);
  }

  /** Hands the newest snapshot to the worker and makes sure a job is running. */
  public void publish(WorldSnapshot snapshot) {
    if (closed || match == null) {
      return;
    }
    var problem = failure.getAndSet(null);
    if (problem != null && problem.generation() == match.generation()) {
      outbox.set(DecisionBoard.EMPTY);
      throw problem.problem();
    }
    if (match.generation() == failedGeneration) return;
    inbox.set(snapshot);
    schedule();
  }

  /** The newest board, with one volatile read. */
  public DecisionBoard board() {
    return outbox.get();
  }

  public ThinkStats stats() {
    return stats;
  }

  /** Whether a job is running or queued right now. */
  public boolean busy() {
    return running.get() || !completion.isDone();
  }

  /** Stops accepting snapshots. A running job finishes on its own. */
  public void close() {
    closed = true;
    endMatch();
  }

  private void schedule() {
    if (!running.compareAndSet(false, true)) {
      return;
    }
    try {
      var queuedAt = nanoClock.getAsLong();
      var live = match;
      var trace =
          ThinkFlight.queued(
              ThinkFlight.context("cycle", live == null ? -1 : live.generation(), -1, nanoClock),
              -1,
              profiles.size());
      compute.executor().execute(() -> run(queuedAt, trace));
    } catch (RejectedExecutionException rejected) {
      running.set(false);
      throw rejected;
    }
  }

  // ---- worker thread ---------------------------------------------------------------------------

  private void run(long queuedAt, ThinkFlight.Task trace) {
    trace.enter();
    var current = match;
    var snapshot = inbox.getAndSet(null);
    if (snapshot != null) trace.tick(snapshot.tick());
    if (current == null || snapshot == null) {
      finished(current, queuedAt, null);
      trace.close();
      return;
    }
    try {
      completion =
          worker
              .think(current, snapshot, queuedAt)
              .whenComplete(
                  (ignored, problem) -> {
                    trace.close();
                    finished(current, queuedAt, problem);
                  });
    } catch (RuntimeException problem) {
      trace.close();
      finished(current, queuedAt, problem);
    }
  }

  private void finished(@Nullable Match current, long queuedAt, @Nullable Throwable problem) {
    if (problem != null) {
      stats.record(nanoClock.getAsLong() - queuedAt);
      if (current != null) {
        failedGeneration = current.generation();
        failure.set(
            new Failure(
                current.generation(),
                new IllegalStateException("Bot thinking cycle failed", problem)));
      }
    }
    if (match == null) worker.retire();
    running.set(false);
    var live = match;
    if (inbox.get() != null && !closed && live != null && live.generation() != failedGeneration) {
      try {
        schedule();
      } catch (RejectedExecutionException rejected) {
        failedGeneration = live.generation();
        failure.set(new Failure(live.generation(), rejected));
      }
    }
  }

  /** The per-bot state the job alone touches. */
  private static final class Mind {
    final BotProfile profile;
    Perception perception;
    TacticsContext tacticsContext;
    long navigationRevision;
    int epoch;
    PerceptionState perceptionState = PerceptionState.EMPTY;
    TacticsState tacticsState;
    @Nullable Percept percept;
    @Nullable Decision decision;
    long lastPerceived = NEVER;
    long lastThought = NEVER;
    long awaitingSince = NEVER;
    long lastReportTick = NEVER;

    Mind(BotProfile profile, Match match, int epoch) {
      var nav = match.nav();
      this.navigationRevision = match.navigationRevision();
      this.profile = profile;
      this.epoch = epoch;
      this.perception =
          new Perception(
              new SenseContext(
                  nav.grid(), nav.graph(), nav.regions(), profile.levers(), match.clouds()));
      this.tacticsContext =
          new TacticsContext(
              nav,
              profile.levers(),
              profile.style(),
              profile.kit(),
              profile.archetype(),
              profile.quirks(),
              seed(match.seed(), profile.id().value(), ROUTE_SALT),
              null);
      this.tacticsState = TacticsState.fresh(epoch);
    }

    void observeNavigation(Match match) {
      var before = tacticsContext;
      if (navigationRevision == match.navigationRevision()) return;
      var nav = match.nav();
      navigationRevision = match.navigationRevision();
      perception =
          new Perception(
              new SenseContext(
                  nav.grid(), nav.graph(), nav.regions(), profile.levers(), match.clouds()));
      tacticsContext =
          new TacticsContext(
              nav,
              before.levers(),
              before.style(),
              before.kit(),
              before.archetype(),
              before.quirks(),
              before.seed(),
              null);
      lastPerceived = NEVER;
      lastThought = NEVER;
    }

    /**
     * A new life: the plan is dropped, what the bot remembers of the enemy and its Time Machine's
     * cooldown are kept.
     */
    void newLife(int newEpoch, long heardThrough) {
      epoch = newEpoch;
      tacticsState = tacticsState.nextLife(newEpoch);
      decision = null;
      perceptionState =
          new PerceptionState(
              perceptionState.memory(),
              perceptionState.suspicion(),
              Math.max(heardThrough, perceptionState.heardThrough()));
      lastPerceived = NEVER;
    }
  }

  /** The per-team state the job alone touches. */
  private static final class Team {
    Blackboard board;
    RetakeAdmission.State admission = RetakeAdmission.State.EMPTY;
    long lastTick = NEVER;

    Team(Blackboard board) {
      this.board = board;
    }
  }

  /** What one job counted. */
  private static final class Counters {
    int perceived;
    int thought;
    int deferred;
    int raysUsed;
  }

  /** One job's fixed inputs. */
  private record Cycle(
      Match current,
      WorldSnapshot snapshot,
      int multiplier,
      Counters counters,
      List<BotProfile> profiles) {

    long tick() {
      return snapshot.tick();
    }
  }

  private ThinkFlight.@Nullable Context flight(Cycle cycle, String stage) {
    return ThinkFlight.context(stage, cycle.current().generation(), cycle.tick(), nanoClock);
  }

  /** The cycle coordinator owns mutable state; parallel operations only return proposals. */
  private final class Worker {
    private final Map<CombatantId, Mind> minds = new HashMap<>();
    private final Map<TeamId, Team> teams = new HashMap<>();
    private int generationSeen = -1;
    private final ThinkBatches batches = new ThinkBatches(compute);
    private List<NavGraph.SearchWorkspace> workspaces = List.of();

    void retire() {
      minds.clear();
      teams.clear();
      workspaces = List.of();
      generationSeen = -1;
    }

    CompletableFuture<Void> think(Match current, WorldSnapshot snapshot, long started) {
      var prepared = prepare(current, snapshot);
      var cycle = prepared.cycle();
      var active = prepared.active();
      var sensing = prepared.sensing();
      return batches
          .map(flight(cycle, "perception"), sensing, mind -> observe(cycle, mind))
          .thenCompose(
              observations -> {
                if (!current(cycle))
                  return CompletableFuture.completedFuture(List.<PendingTeam>of());
                var observationCommit =
                    ThinkFlight.section(flight(cycle, "observation-commit"), observations.size());
                try {
                  for (var observation : observations) commitObservation(cycle, observation);
                } finally {
                  observationCommit.close();
                }
                var orderedTeams =
                    teams.entrySet().stream()
                        .sorted(Map.Entry.comparingByKey(Comparator.comparing(TeamId::value)))
                        .map(Map.Entry::getValue)
                        .toList();
                return batches.map(
                    flight(cycle, "team-prepare"), orderedTeams, team -> prepareTeam(cycle, team));
              })
          .thenCompose(pending -> dealTeams(cycle, pending))
          .thenCompose(
              plans -> {
                if (!current(cycle)) return CompletableFuture.completedFuture(List.<Proposal>of());
                var teamCommit = ThinkFlight.section(flight(cycle, "team-commit"), plans.size());
                try {
                  for (var plan : plans) {
                    plan.team().board = plan.board();
                    plan.team().admission = plan.admission();
                    plan.team().lastTick = plan.tick();
                  }
                } finally {
                  teamCommit.close();
                }
                return batches.balanced(
                    flight(cycle, "tactics"),
                    selectTactics(cycle, active),
                    (batch, work) -> propose(cycle, work, workspaces.get(batch)));
              })
          .thenAccept(
              proposals -> {
                var tacticsCommit =
                    ThinkFlight.section(flight(cycle, "tactics-commit"), proposals.size());
                try {
                  for (var proposal : proposals) commitTactics(cycle, proposal);
                } finally {
                  tacticsCommit.close();
                }
                var publish = ThinkFlight.section(flight(cycle, "publish"), active.size());
                try {
                  publishBoard(cycle, active, started);
                } finally {
                  publish.close();
                }
              });
    }

    private Prepared prepare(Match current, WorldSnapshot snapshot) {
      var prepare =
          ThinkFlight.section(
              ThinkFlight.context("prepare", current.generation(), snapshot.tick(), nanoClock),
              profiles.size());
      try {
        if (generationSeen != current.generation()) {
          minds.clear();
          teams.clear();
          generationSeen = current.generation();
          workspaces =
              IntStream.range(0, compute.parallelism())
                  .mapToObj(ignored -> current.nav().graph().workspace())
                  .toList();
        }
        var active = activeMinds(current, snapshot);
        var cycle =
            new Cycle(
                current,
                snapshot,
                governor.thinkPeriodMultiplier(),
                new Counters(),
                active.stream().map(mind -> mind.profile).toList());
        // The schedule timestamp is aligned to a slot; freshness uses the actual observation tick.
        return new Prepared(cycle, active, selectSensing(cycle, active));
      } finally {
        prepare.close();
      }
    }

    private List<Mind> selectSensing(Cycle cycle, List<Mind> active) {
      var sensing = new ArrayList<>(active);
      sensing.sort(
          Comparator.comparingLong((Mind m) -> m.percept == null ? NEVER : m.percept.tick())
              .thenComparingInt(m -> m.profile.slot()));
      var selected = new ArrayList<Mind>();
      var counters = cycle.counters();
      var period = rates.perceptionEveryTicks() * cycle.multiplier();
      for (var mind : sensing) {
        if (mind.percept != null && !due(mind.lastPerceived, cycle.tick(), period)) continue;
        var rays =
            rayEstimate(
                cycle.snapshot().require(mind.profile.id()),
                cycle.snapshot(),
                mind.profile.levers().awarenessRadius());
        if (counters.raysUsed > 0 && counters.raysUsed + rays > rates.losRayBudget()) {
          counters.deferred++;
        } else {
          counters.raysUsed += rays;
          selected.add(mind);
        }
      }
      return selected;
    }

    private void publishBoard(Cycle cycle, List<Mind> active, long started) {
      var current = cycle.current();
      var snapshot = cycle.snapshot();
      var counters = cycle.counters();
      var thoughts = new HashMap<CombatantId, BotThought>();
      var perceptions = freshness(active);
      for (var mind : minds.values()) {
        if (publishable(mind, snapshot) && mind.decision != null && mind.percept != null) {
          thoughts.put(mind.profile.id(), new BotThought(mind.decision, mind.percept, mind.epoch));
        }
      }
      var elapsed = nanoClock.getAsLong() - started;
      stats.record(elapsed);
      var plans = new HashMap<TeamId, TeamPlan>();
      teams.forEach((id, team) -> plans.put(id, team.board.plan()));
      var live = match;
      if (live != null
          && live.generation() == current.generation()
          && live.navigationRevision() == current.navigationRevision()) {
        outbox.set(
            new DecisionBoard(
                snapshot.tick(),
                thoughts,
                elapsed,
                counters.perceived,
                counters.thought,
                counters.deferred,
                plans,
                perceptions));
      }
    }

    private boolean valid(Mind mind) {
      return mind.profile.equals(profiles.get(mind.profile.id()))
          && mind.epoch == epoch(mind.profile.id());
    }

    private boolean publishable(Mind mind, WorldSnapshot snapshot) {
      if (!mind.profile.equals(profiles.get(mind.profile.id()))) return false;
      // Keep a dead bot's last thought for diagnostics, with its original tick and life epoch.
      // Living bots never publish an obsolete life; commit guards still reject stale proposals.
      return mind.epoch == epoch(mind.profile.id())
          || snapshot.combatant(mind.profile.id()).map(view -> !view.alive()).orElse(false);
    }

    private boolean current(Cycle cycle) {
      var live = match;
      return live != null
          && live.generation() == cycle.current().generation()
          && live.navigationRevision() == cycle.current().navigationRevision();
    }

    private Map<CombatantId, PerceptionAge> freshness(List<Mind> active) {
      var observations = new HashMap<CombatantId, PerceptionAge>();
      for (var mind : active) {
        // A rewind invalidates decisions, not the fact that an earlier observation happened.
        // Retain its actual timestamp until the new life is perceived; rejected observations
        // never advance it. Only a bot never perceived is awaiting its first observation.
        if (!mind.profile.equals(profiles.get(mind.profile.id()))) continue;
        observations.put(
            mind.profile.id(),
            new PerceptionAge(
                mind.percept == null ? mind.awaitingSince : mind.percept.tick(),
                mind.percept == null));
      }
      return observations;
    }

    /** The registered bots alive in the snapshot, in slot order, with their minds up to date. */
    private List<Mind> activeMinds(Match current, WorldSnapshot snapshot) {
      minds.keySet().removeIf(id -> !profiles.containsKey(id));
      var active = new ArrayList<Mind>();
      for (var profile : profiles()) {
        var self = snapshot.combatant(profile.id());
        if (self.isEmpty() || !self.orElseThrow().alive()) {
          continue;
        }
        var mind = minds.get(profile.id());
        var epoch = epoch(profile.id());
        if (mind == null || !mind.profile.equals(profile)) {
          mind = new Mind(profile, current, epoch);
          minds.put(profile.id(), mind);
        } else if (mind.epoch != epoch) {
          mind.newLife(
              epoch,
              snapshot.stimuli().isEmpty()
                  ? mind.perceptionState.heardThrough()
                  : snapshot.stimuli().getLast().sequence());
        }
        mind.observeNavigation(current);
        if (mind.awaitingSince == NEVER) mind.awaitingSince = snapshot.tick();
        team(current, profile.team());
        active.add(mind);
      }
      return active;
    }

    private Team team(Match current, TeamId id) {
      var team = teams.get(id);
      if (team == null) {
        var members = profiles().stream().filter(p -> p.team().equals(id)).toList();
        var aggression = members.stream().mapToDouble(p -> p.style().aggression()).average();
        var patience = members.stream().mapToDouble(p -> p.style().patience()).average();
        var strategy =
            TeamBrain.chooseStrategy(
                aggression.orElse(0.5),
                patience.orElse(0.5),
                members.size(),
                new SplittableRandom(current.seed() ^ id.value().hashCode()));
        team = new Team(Blackboard.open(id, strategy));
        teams.put(id, team);
      }
      return team;
    }

    private Observation observe(Cycle cycle, Mind mind) {
      var random = randomFor(cycle.current(), mind.profile.id(), cycle.tick());
      return new Observation(
          mind,
          mind.perception.perceive(
              mind.perceptionState,
              cycle.snapshot().require(mind.profile.id()),
              cycle.snapshot(),
              random));
    }

    private void commitObservation(Cycle cycle, Observation observation) {
      var mind = observation.mind();
      if (!current(cycle) || !valid(mind)) return;
      var percept = observation.percept();
      mind.perceptionState = percept.state();
      mind.percept = percept;
      mind.lastPerceived =
          aligned(
              cycle.tick(), mind.profile.slot(), rates.perceptionEveryTicks() * cycle.multiplier());
      cycle.counters().perceived++;
      share(cycle.current(), mind, percept, cycle.snapshot());
    }

    private void share(Match current, Mind mind, Percept percept, WorldSnapshot snapshot) {
      var reports = new ArrayList<SharedSighting>();
      for (var seen : percept.visible()) {
        reports.add(
            new SharedSighting(
                seen.id(),
                seen.pos(),
                seen.vel(),
                snapshot.tick(),
                snapshot.tick(),
                mind.profile.id()));
      }
      percept.state().memory().sightings().entrySet().stream()
          .filter(
              entry ->
                  !entry.getValue().direct() && snapshot.tick() - entry.getValue().tick() <= 30)
          .sorted(Map.Entry.comparingByKey())
          .forEach(
              entry ->
                  reports.add(
                      new SharedSighting(
                          entry.getKey(),
                          entry.getValue().pos(),
                          entry.getValue().vel(),
                          entry.getValue().tick(),
                          snapshot.tick(),
                          mind.profile.id())));
      if (reports.isEmpty()) return;
      if (composedCommunication) {
        if (mind.lastReportTick == NEVER || snapshot.tick() - mind.lastReportTick >= 40) {
          mind.lastReportTick = snapshot.tick();
          ThinkLoop.this.reports.put(
              mind.profile.id(),
              new TeamReport(
                  current.generation(), mind.epoch, mind.profile.team(), reports.getFirst()));
        }
        return;
      }
      var team = team(current, mind.profile.team());
      team.board =
          team.board.share(
              reports,
              mind.profile.levers().coordination(),
              snapshot.tick(),
              randomFor(current, mind.profile.id(), snapshot.tick() + 1));
    }

    private PendingTeam prepareTeam(Cycle cycle, Team team) {
      receiveReports(cycle);
      var sensor = sensors.remove(team.board.team());
      if (sensor != null && sensor.generation() == cycle.current().generation())
        team.board = team.board.sensor(sensor.clue());
      var snapshot = cycle.snapshot();
      var period = rates.teamEveryTicks() * cycle.multiplier();
      var members = new HashMap<CombatantId, SlotFit.Member>();
      var views = new ArrayList<CombatantView>();
      for (var profile : cycle.profiles()) {
        if (!profile.team().equals(team.board.team())) {
          continue;
        }
        var view = snapshot.combatant(profile.id());
        if (view.isPresent() && view.orElseThrow().alive()) {
          views.add(view.orElseThrow());
          members.put(
              profile.id(),
              new SlotFit.Member(
                  profile.archetype(), profile.quirks(), profile.roleWeights(), profile.kit()));
        }
      }
      // A bot that joined since the last deal must get a slot before it thinks.
      var unassigned = !team.board.plan().assignment().keySet().containsAll(members.keySet());
      var unchanged = new TeamStep(team, team.board, team.lastTick, team.admission);
      if (views.isEmpty()
          || (!unassigned
              && !retakeInvalidated(team, snapshot)
              && !due(team.lastTick, snapshot.tick(), period))) {
        return new PendingTeam(unchanged, Optional.empty());
      }
      var current = cycle.current();
      return new PendingTeam(
          unchanged,
          Optional.of(
              TeamBrain.prepare(
                  team.board,
                  new TeamBrain.TeamSituation(current.nav(), snapshot, views, members))));
    }

    private boolean retakeInvalidated(Team team, WorldSnapshot snapshot) {
      if (team.admission.invalidated(snapshot)) return true;
      // newLife clears the decision before this cycle; never carry a reservation across epochs.
      return team.admission.admitted().keySet().stream()
          .anyMatch(
              id -> {
                var mind = minds.get(id);
                return mind == null || mind.decision == null;
              });
    }

    private void receiveReports(Cycle cycle) {
      var ready =
          deliveredReports.values().stream()
              .sorted(Comparator.comparing(report -> report.sighting().reporter()))
              .toList();
      for (var report : ready) {
        if (!deliveredReports.remove(report.sighting().reporter(), report)) continue;
        var reporter = profiles.get(report.sighting().reporter());
        if (report.generation() != cycle.current().generation()
            || reporter == null
            || report.lifeEpoch() != epoch(reporter.id())
            || !report.team().equals(reporter.team())
            || cycle.tick() - report.sighting().seenTick() > 120) continue;
        var recipient = team(cycle.current(), report.team());
        recipient.board =
            recipient.board.share(
                List.of(report.sighting()),
                1,
                cycle.tick(),
                randomFor(cycle.current(), reporter.id(), cycle.tick() + 3));
      }
    }

    private CompletableFuture<List<TeamStep>> dealTeams(Cycle cycle, List<PendingTeam> pending) {
      if (!current(cycle)) return CompletableFuture.completedFuture(List.of());
      var queries = new ArrayList<RoleRow>();
      for (var team : pending) {
        team.prepared()
            .ifPresent(
                prepared -> {
                  for (var row = 0; row < prepared.distanceRows(); row++)
                    queries.add(new RoleRow(prepared, row));
                });
      }
      return batches
          .indexed(
              flight(cycle, "team-distance"),
              queries,
              (batch, query) -> query.prepared().distances(query.row(), workspaces.get(batch)))
          .thenCompose(distances -> completeTeams(cycle, pending, distances));
    }

    private CompletableFuture<List<TeamStep>> completeTeams(
        Cycle cycle, List<PendingTeam> pending, List<float[]> distances) {
      if (!current(cycle)) return CompletableFuture.completedFuture(List.of());
      var completions = new ArrayList<TeamCompletion>();
      var cursor = 0;
      for (var team : pending) {
        var count = team.prepared().map(TeamBrain.Prepared::distanceRows).orElse(0);
        completions.add(
            new TeamCompletion(team, List.copyOf(distances.subList(cursor, cursor + count))));
        cursor += count;
      }
      return batches
          .map(
              flight(cycle, "team-score"), completions, completion -> finishTeam(cycle, completion))
          .thenCompose(steps -> admitTeams(cycle, completions, steps));
    }

    private CompletableFuture<List<TeamStep>> admitTeams(
        Cycle cycle, List<TeamCompletion> completions, List<TeamStep> steps) {
      if (!current(cycle)) return CompletableFuture.completedFuture(List.of());
      var admissions = new ArrayList<AdmissionWork>();
      for (var index = 0; index < steps.size(); index++)
        admissions.add(new AdmissionWork(completions.get(index), steps.get(index)));
      return batches.indexed(
          flight(cycle, "retake-feasibility"),
          admissions,
          (batch, work) -> admitTeam(cycle, work, workspaces.get(batch)));
    }

    private TeamStep admitTeam(
        Cycle cycle, AdmissionWork work, NavGraph.SearchWorkspace workspace) {
      var step = work.step();
      if (work.completion().pending().prepared().isEmpty()) return step;
      var routes =
          new RetakeAdmission.Routes() {
            @Override
            public List<CombatantId> candidates(Slot worker) {
              return workerCandidates(cycle, work, worker);
            }

            @Override
            public boolean reachable(CombatantId id, Slot worker, Blackboard provisional) {
              return workerReachable(cycle, new WorkerRoute(id, worker, provisional), workspace);
            }
          };
      var result =
          RetakeAdmission.verify(
              step.board(),
              step.admission(),
              new RetakeAdmission.Context(cycle.current().nav(), cycle.snapshot()),
              routes);
      return new TeamStep(step.team(), result.board(), step.tick(), result.state());
    }

    private List<CombatantId> workerCandidates(Cycle cycle, AdmissionWork work, Slot worker) {
      var prepared = work.completion().pending().prepared().orElseThrow();
      var staged = prepared.workerCandidates(worker, work.completion().distances());
      if (!staged.isEmpty()) return staged;
      return cycle.snapshot().alive(work.step().board().team()).stream()
          .filter(bot -> work.step().board().plan().assignment().containsKey(bot.id()))
          .sorted(
              Comparator.comparingDouble(
                      (CombatantView bot) -> bot.pos().distanceSquared(worker.pos()))
                  .thenComparing(CombatantView::id))
          .map(CombatantView::id)
          .toList();
    }

    private boolean workerReachable(
        Cycle cycle, WorkerRoute route, NavGraph.SearchWorkspace workspace) {
      var mind = minds.get(route.id());
      if (mind == null || mind.percept == null || !valid(mind)) return false;
      var situation =
          new Situation(
              cycle.snapshot().require(route.id()),
              cycle.snapshot(),
              mind.percept,
              route.board(),
              Role.RETAKE);
      var measurement = ThinkFlight.bot(flight(cycle, "retake-route"), route.id().value());
      try {
        return Planner.canReachWorker(
            situation, mind.tacticsContext.withWorkspace(workspace), route.worker());
      } finally {
        measurement.close();
      }
    }

    private TeamStep finishTeam(Cycle cycle, TeamCompletion completion) {
      var pending = completion.pending();
      if (pending.prepared().isEmpty()) return pending.unchanged();
      var team = pending.unchanged().team();
      var random =
          new SplittableRandom(
              seed(
                  cycle.current().seed(),
                  pending.unchanged().board().team().value().hashCode(),
                  cycle.tick()));
      return new TeamStep(
          team,
          pending.prepared().orElseThrow().finish(completion.distances(), random),
          cycle.tick(),
          team.admission);
    }

    private List<TacticsWork> selectTactics(Cycle cycle, List<Mind> active) {
      var selected = new ArrayList<TacticsWork>();
      var period = rates.tacticsEveryTicks() * cycle.multiplier();
      for (var mind : active) {
        var id = mind.profile.id();
        var forced = replans.contains(id) || mind.decision == null;
        if (!valid(mind)
            || mind.percept == null
            || (!forced && !due(mind.lastThought, cycle.tick(), period))) continue;
        replans.remove(id);
        selected.add(new TacticsWork(mind, team(cycle.current(), mind.profile.team()).board));
      }
      return selected;
    }

    private Proposal propose(Cycle cycle, TacticsWork work, NavGraph.SearchWorkspace workspace) {
      var mind = work.mind();
      var id = mind.profile.id();
      var board = work.board();
      var role = board.roleOf(id).orElseThrow(() -> new IllegalStateException(id + " has no role"));
      var percept = java.util.Objects.requireNonNull(mind.percept);
      var situation =
          new Situation(cycle.snapshot().require(id), cycle.snapshot(), percept, board, role);
      var measurement = ThinkFlight.bot(flight(cycle, "tactics-bot"), id.value());
      try {
        var thought =
            Tactics.think(
                mind.tacticsState,
                situation,
                mind.tacticsContext.withWorkspace(workspace),
                randomFor(cycle.current(), id, cycle.tick() + 2));
        return new Proposal(mind, thought);
      } finally {
        measurement.close();
      }
    }

    /**
     * Whether a proposal made against an older board clashes with what teammates committed since:
     * it takes cover a teammate now holds, or it answers an enemy now answered too often, or from a
     * side of the ring another guard now takes.
     */
    private boolean conflicting(Cycle cycle, Proposal proposal, Blackboard board) {
      return !Tactics.admitted(proposal.thought(), board) || coverTaken(cycle, proposal, board);
    }

    private boolean coverTaken(Cycle cycle, Proposal proposal, Blackboard board) {
      var cover = proposal.thought().note().cover();
      if (cover.isEmpty()) return false;
      var graph = cycle.current().nav().graph();
      var point = graph.feet(cover.orElseThrow());
      return board.claimedCover().entrySet().stream()
          .filter(entry -> !entry.getKey().equals(proposal.mind().profile.id()))
          .anyMatch(
              entry -> graph.feet(entry.getValue()).horizontalDistance(point) < Planner.COVER_ROOM);
    }

    private void commitTactics(Cycle cycle, Proposal original) {
      var mind = original.mind();
      if (!current(cycle) || !valid(mind)) return;
      var id = mind.profile.id();
      var team = team(cycle.current(), mind.profile.team());
      var proposal =
          conflicting(cycle, original, team.board)
              ? propose(cycle, new TacticsWork(mind, team.board), workspaces.getFirst())
              : original;
      if (conflicting(cycle, proposal, team.board)) {
        throw new IllegalStateException("Conflicting tactics proposal for " + id);
      }
      var thought = proposal.thought();
      mind.tacticsState = thought.state();
      mind.decision = thought.decision();
      team.board = team.board.note(id, thought.note());
      mind.lastThought =
          aligned(
              cycle.tick(), mind.profile.slot(), rates.tacticsEveryTicks() * cycle.multiplier());
      cycle.counters().thought++;
      traces.record(thought.trace(), thought.decision());
    }
  }

  private record Observation(Mind mind, Percept percept) {}

  private record Prepared(Cycle cycle, List<Mind> active, List<Mind> sensing) {}

  private record TeamStep(
      Team team, Blackboard board, long tick, RetakeAdmission.State admission) {}

  private record PendingTeam(TeamStep unchanged, Optional<TeamBrain.Prepared> prepared) {}

  private record RoleRow(TeamBrain.Prepared prepared, int row) {}

  private record TeamCompletion(PendingTeam pending, List<float[]> distances) {}

  private record AdmissionWork(TeamCompletion completion, TeamStep step) {}

  private record WorkerRoute(CombatantId id, Slot worker, Blackboard board) {}

  private record TacticsWork(Mind mind, Blackboard board) {}

  private record Proposal(Mind mind, Thought thought) {}

  /** Whether a layer last run at {@code last} is due at {@code tick} with {@code period}. */
  static boolean due(long last, long tick, int period) {
    return last == NEVER || tick - last >= period;
  }

  /**
   * The latest grid point at or before {@code tick} for a bot in {@code slot}: layers run when
   * {@code (tick + slot) % period == 0}, so bots with different slots think on different ticks.
   */
  static long aligned(long tick, int slot, int period) {
    return tick - Math.floorMod(tick + slot, period);
  }

  /** Three rays per living enemy inside the awareness radius. */
  static int rayEstimate(CombatantView self, WorldSnapshot snapshot, double awareness) {
    var count = 0;
    for (var other : snapshot.aliveEnemiesOf(self.team())) {
      if (other.pos().distance(self.pos()) <= awareness) {
        count += 3;
      }
    }
    return Math.max(1, count);
  }

  private static SplittableRandom randomFor(Match match, CombatantId bot, long tick) {
    return new SplittableRandom(seed(match.seed(), bot.value(), tick));
  }

  /** A well-mixed seed from the match seed, the bot and the tick. */
  public static long seed(long matchSeed, int bot, long tick) {
    var mixed = matchSeed ^ (bot * 0x9E3779B97F4A7C15L) ^ (tick * 0xC2B2AE3D27D4EB4FL);
    mixed ^= mixed >>> 31;
    mixed *= 0x7FB5D329728EA185L;
    mixed ^= mixed >>> 27;
    return mixed;
  }
}
