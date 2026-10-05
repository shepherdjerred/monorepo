package com.shepherdjerred.thestorm.rwfbots.app;

import com.shepherdjerred.thestorm.core.compute.ComputePool;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Percept;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Perception;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.PerceptionState;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.SenseContext;
import com.shepherdjerred.thestorm.rwfbots.domain.tactics.Situation;
import com.shepherdjerred.thestorm.rwfbots.domain.tactics.Tactics;
import com.shepherdjerred.thestorm.rwfbots.domain.tactics.TacticsContext;
import com.shepherdjerred.thestorm.rwfbots.domain.tactics.TacticsState;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Blackboard;
import com.shepherdjerred.thestorm.rwfbots.domain.team.SharedSighting;
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
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.LongSupplier;
import org.jspecify.annotations.Nullable;

/**
 * The bots' think layers off the main thread. Each tick the main thread {@linkplain #publish
 * publishes} an immutable {@link WorldSnapshot} into a one-slot mailbox (a newer snapshot replaces
 * one not yet consumed) and, if no think job is running, submits one to the compute pool. The job
 * takes the newest snapshot, runs perception, the team step and tactics for the bots due this
 * cycle, and publishes a {@link DecisionBoard} into a second one-slot mailbox that the main thread
 * reads with one volatile read.
 *
 * <p>Only one job runs at a time, so the per-bot and per-team think state belongs to the job alone.
 * The main thread only registers bots, bumps life epochs and asks for rethinks through concurrent
 * maps. Randomness is a fresh {@link SplittableRandom} per bot per job, seeded from the match seed,
 * the bot and the tick, so a replay with the same snapshots makes the same decisions.
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
  private final ThinkStats stats = new ThinkStats();
  private final Worker worker = new Worker();
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
  }

  /** The match the loop thinks for. */
  private record Match(int generation, long seed, NavArtifact nav) {}

  // ---- main thread -----------------------------------------------------------------------------

  /** Starts thinking for a match on {@code nav}; forgets every bot of the previous match. */
  public void beginMatch(long seed, NavArtifact nav) {
    profiles.clear();
    epochs.clear();
    replans.clear();
    outbox.set(DecisionBoard.EMPTY);
    match = new Match(generation.incrementAndGet(), seed, nav);
  }

  /** Stops thinking; publishes are ignored until the next match begins. */
  public void endMatch() {
    match = null;
    profiles.clear();
    epochs.clear();
    replans.clear();
    inbox.set(null);
    outbox.set(DecisionBoard.EMPTY);
  }

  public boolean inMatch() {
    return match != null;
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
    return running.get();
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
      compute.executor().execute(this::run);
    } catch (RejectedExecutionException rejected) {
      running.set(false);
      throw rejected;
    }
  }

  // ---- worker thread ---------------------------------------------------------------------------

  private void run() {
    try {
      WorldSnapshot snapshot;
      while ((snapshot = inbox.getAndSet(null)) != null) {
        var current = match;
        if (current != null) {
          worker.think(current, snapshot);
        }
      }
    } finally {
      running.set(false);
    }
    if (inbox.get() != null && !closed) {
      schedule();
    }
  }

  /** The per-bot state the job alone touches. */
  private static final class Mind {
    final BotProfile profile;
    final Perception perception;
    final TacticsContext tacticsContext;
    int epoch;
    PerceptionState perceptionState = PerceptionState.EMPTY;
    TacticsState tacticsState;
    @Nullable Percept percept;
    @Nullable Decision decision;
    long lastPerceived = NEVER;
    long lastThought = NEVER;

    Mind(BotProfile profile, Match match, int epoch) {
      var nav = match.nav();
      this.profile = profile;
      this.epoch = epoch;
      this.perception =
          new Perception(
              new SenseContext(nav.grid(), nav.graph(), nav.regions(), profile.levers()));
      this.tacticsContext =
          new TacticsContext(
              nav,
              profile.levers(),
              profile.style(),
              profile.kit(),
              profile.archetype(),
              profile.quirks(),
              seed(match.seed(), profile.id().value(), ROUTE_SALT));
      this.tacticsState = TacticsState.fresh(epoch);
    }

    /**
     * A new life: the plan is dropped, what the bot remembers of the enemy and its Time Machine's
     * cooldown are kept.
     */
    void newLife(int newEpoch) {
      epoch = newEpoch;
      tacticsState = tacticsState.nextLife(newEpoch);
      decision = null;
    }
  }

  /** The per-team state the job alone touches. */
  private static final class Team {
    Blackboard board;
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
  private record Cycle(Match current, WorldSnapshot snapshot, int multiplier, Counters counters) {

    long tick() {
      return snapshot.tick();
    }
  }

  /** The job: owns the think state; only ever runs on one thread at a time. */
  private final class Worker {
    private final Map<CombatantId, Mind> minds = new HashMap<>();
    private final Map<TeamId, Team> teams = new HashMap<>();
    private int generationSeen = -1;

    void think(Match current, WorldSnapshot snapshot) {
      var started = nanoClock.getAsLong();
      if (generationSeen != current.generation()) {
        minds.clear();
        teams.clear();
        generationSeen = current.generation();
      }
      var cycle = new Cycle(current, snapshot, governor.thinkPeriodMultiplier(), new Counters());
      var active = activeMinds(current, snapshot);
      for (var mind : active) {
        perceive(cycle, mind);
      }
      for (var team : teams.values()) {
        teamStep(cycle, team);
      }
      for (var mind : active) {
        decide(cycle, mind);
      }
      var counters = cycle.counters();
      var thoughts = new HashMap<CombatantId, BotThought>();
      for (var mind : minds.values()) {
        if (mind.decision != null && mind.percept != null) {
          thoughts.put(mind.profile.id(), new BotThought(mind.decision, mind.percept, mind.epoch));
        }
      }
      var elapsed = nanoClock.getAsLong() - started;
      stats.record(elapsed);
      var plans = new HashMap<TeamId, TeamPlan>();
      teams.forEach((id, team) -> plans.put(id, team.board.plan()));
      var live = match;
      if (live != null && live.generation() == current.generation()) {
        outbox.set(
            new DecisionBoard(
                snapshot.tick(),
                thoughts,
                elapsed,
                counters.perceived,
                counters.thought,
                counters.deferred,
                plans));
      }
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
          mind.newLife(epoch);
        }
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

    private void perceive(Cycle cycle, Mind mind) {
      var current = cycle.current();
      var snapshot = cycle.snapshot();
      var counters = cycle.counters();
      var tick = cycle.tick();
      var period = rates.perceptionEveryTicks() * cycle.multiplier();
      if (mind.percept != null && !due(mind.lastPerceived, tick, period)) {
        return;
      }
      var self = snapshot.require(mind.profile.id());
      var rays = rayEstimate(self, snapshot, mind.profile.levers().awarenessRadius());
      if (mind.percept != null
          && counters.raysUsed > 0
          && counters.raysUsed + rays > rates.losRayBudget()) {
        counters.deferred++;
        return;
      }
      counters.raysUsed += rays;
      var random = randomFor(current, mind.profile.id(), tick);
      var percept = mind.perception.perceive(mind.perceptionState, self, snapshot, random);
      mind.perceptionState = percept.state();
      mind.percept = percept;
      mind.lastPerceived = aligned(tick, mind.profile.slot(), period);
      counters.perceived++;
      share(current, mind, percept, snapshot);
    }

    private void share(Match current, Mind mind, Percept percept, WorldSnapshot snapshot) {
      if (percept.visible().isEmpty()) {
        return;
      }
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
      var team = team(current, mind.profile.team());
      team.board =
          team.board.share(
              reports,
              mind.profile.levers().coordination(),
              snapshot.tick(),
              randomFor(current, mind.profile.id(), snapshot.tick() + 1));
    }

    private void teamStep(Cycle cycle, Team team) {
      var snapshot = cycle.snapshot();
      var period = rates.teamEveryTicks() * cycle.multiplier();
      var members = new HashMap<CombatantId, SlotFit.Member>();
      var views = new ArrayList<CombatantView>();
      for (var profile : profiles()) {
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
      if (views.isEmpty() || (!unassigned && !due(team.lastTick, snapshot.tick(), period))) {
        return;
      }
      team.lastTick = snapshot.tick();
      var current = cycle.current();
      team.board =
          TeamBrain.tick(
              team.board,
              new TeamBrain.TeamSituation(current.nav(), snapshot, views, members),
              new SplittableRandom(
                  seed(current.seed(), team.board.team().value().hashCode(), snapshot.tick())));
    }

    private void decide(Cycle cycle, Mind mind) {
      var current = cycle.current();
      var snapshot = cycle.snapshot();
      var tick = cycle.tick();
      var period = rates.tacticsEveryTicks() * cycle.multiplier();
      var id = mind.profile.id();
      var forced = replans.contains(id) || mind.decision == null;
      if (!forced && !due(mind.lastThought, tick, period)) {
        return;
      }
      var percept = mind.percept;
      if (percept == null) {
        return;
      }
      replans.remove(id);
      var team = team(current, mind.profile.team());
      var board = team.board;
      var role = board.roleOf(id).orElseThrow(() -> new IllegalStateException(id + " has no role"));
      var situation = new Situation(snapshot.require(id), snapshot, percept, board, role);
      var thought =
          Tactics.think(
              mind.tacticsState, situation, mind.tacticsContext, randomFor(current, id, tick + 2));
      mind.tacticsState = thought.state();
      mind.decision = thought.decision();
      team.board = team.board.note(id, thought.note());
      mind.lastThought = aligned(tick, mind.profile.slot(), period);
      cycle.counters().thought++;
      traces.record(thought.trace(), thought.decision());
    }
  }

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
