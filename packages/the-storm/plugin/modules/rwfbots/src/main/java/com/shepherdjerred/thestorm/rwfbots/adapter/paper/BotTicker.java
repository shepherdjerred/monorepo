package com.shepherdjerred.thestorm.rwfbots.adapter.paper;

import com.shepherdjerred.thestorm.rwf.app.MatchView;
import com.shepherdjerred.thestorm.rwf.app.view.MatchState;
import com.shepherdjerred.thestorm.rwfbots.app.BotProfile;
import com.shepherdjerred.thestorm.rwfbots.app.BotThought;
import com.shepherdjerred.thestorm.rwfbots.app.DecisionBoard;
import com.shepherdjerred.thestorm.rwfbots.app.DecisionGate;
import com.shepherdjerred.thestorm.rwfbots.app.Governor;
import com.shepherdjerred.thestorm.rwfbots.app.ThinkLoop;
import com.shepherdjerred.thestorm.rwfbots.app.ThinkStats;
import com.shepherdjerred.thestorm.rwfbots.domain.map.VoxelGrid;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Percept;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Perception;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.PerceptionState;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.Reflex;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.ReflexContext;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.ReflexInput;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.util.Arrays;
import java.util.List;
import java.util.function.LongSupplier;
import java.util.function.Supplier;
import org.bukkit.Material;
import org.bukkit.entity.Player;

/**
 * The bots' one main-thread task, every tick while a match is live: capture the world, publish it
 * to the think loop, read the newest board, judge each thought, run every bot's reflex and apply
 * the commands to its body. Then the governor hears how long the server's recent ticks took and how
 * long the bot sections did. A bot's action can end the match synchronously; the tick then stops
 * driving bots, since its snapshot and board belong to the finished match. Main thread only.
 */
public final class BotTicker {

  /** The hotbar and the main inventory slots. */
  static final int HOTBAR_AND_STORAGE = 36;

  private final Roster roster;
  private final ThinkLoop loop;
  private final Governor governor;
  private final DecisionGate gate;
  private final BodyDriver driver;
  private final MatchView view;
  private final Supplier<long[]> tickTimes;
  private final LongSupplier nanoClock;
  private final LobbyTicker lobby;
  private final com.shepherdjerred.thestorm.rwf.app.ObservationSource observations;
  private final com.shepherdjerred.thestorm.rwfbots.app.learning.MatchLearning learning;
  private boolean inLobby;
  private final ThinkStats staleness = new ThinkStats();
  private final ThinkStats sections = new ThinkStats();
  private long tick;

  /**
   * What the ticker drives.
   *
   * @param roster the bots and the match session
   * @param loop the think loop
   * @param governor the load governor
   * @param gate the staleness gate
   * @param driver applies commands to bodies
   * @param view rwf's read model
   * @param tickTimes the server's recent tick times in nanoseconds
   * @param nanoClock a monotonic clock
   * @param lobby drives the bots before the match
   */
  public record Parts(
      Roster roster,
      ThinkLoop loop,
      Governor governor,
      DecisionGate gate,
      BodyDriver driver,
      MatchView view,
      Supplier<long[]> tickTimes,
      LongSupplier nanoClock,
      LobbyTicker lobby,
      com.shepherdjerred.thestorm.rwf.app.ObservationSource observations,
      com.shepherdjerred.thestorm.rwfbots.app.learning.MatchLearning learning) {}

  public BotTicker(Parts parts) {
    this.roster = parts.roster();
    this.loop = parts.loop();
    this.governor = parts.governor();
    this.gate = parts.gate();
    this.driver = parts.driver();
    this.view = parts.view();
    this.tickTimes = parts.tickTimes();
    this.nanoClock = parts.nanoClock();
    this.lobby = parts.lobby();
    this.observations = parts.observations();
    this.learning = parts.learning();
  }

  /** The ticks run so far; the snapshot clock. */
  public long tick() {
    return tick;
  }

  /** Decision age at the moment of following, in ticks, recent p95. */
  public double stalenessP95() {
    return staleness.percentileMillis(0.95) * 1_000_000;
  }

  /** How long the bot sections of recent ticks took, p95 in milliseconds. */
  public double sectionP95Millis() {
    return sections.percentileMillis(0.95);
  }

  public com.shepherdjerred.thestorm.rwfbots.app.learning.MatchLearning.Metrics learningMetrics() {
    return learning.metrics();
  }

  /** One server tick. */
  public void run() {
    tick++;
    learning.startTick(tick);
    if (lobbyTick()) {
      return;
    }
    var session = roster.session();
    if (session.isEmpty() || !loop.inMatch()) {
      return;
    }
    var started = nanoClock.getAsLong();
    var state = view.current().map(MatchState::of);
    if (state.isEmpty() || state.orElseThrow().phase() != MatchState.Phase.LIVE) {
      return;
    }
    var match = session.orElseThrow();
    var snapshot = match.capture().capture(tick, state.orElseThrow());
    roster.harness().captureTick(match.matchId(), tick);
    loop.publish(snapshot);
    var frame = new Frame(match, snapshot, loop.board());
    for (var bot : roster.live()) {
      if (!sameMatch(match)) {
        // An earlier bot's action ended the match (a killing blow, a defuse) and rwf settled it
        // synchronously: the rest of this tick's snapshot and board belong to a finished match.
        break;
      }
      bot.profile().ifPresent(profile -> drive(bot, profile, frame));
    }
    if (sameMatch(match)) {
      roster.harness().finishTick(match.matchId(), tick);
      learning.finishTick(match.matchId(), tick);
    }
    var elapsed = nanoClock.getAsLong() - started;
    sections.record(elapsed);
    governor.observe(new Governor.Sample(msptP95(tickTimes.get()), elapsed / 1_000_000.0));
  }

  /**
   * Before the match the {@link LobbyTicker} drives the bots; once the lobby closes it is told so.
   * Returns whether this tick was a lobby tick.
   */
  private boolean lobbyTick() {
    var state = view.current().map(MatchState::of);
    var phase = state.map(MatchState::phase);
    var waiting = phase.filter(p -> p == MatchState.Phase.LOBBY || p == MatchState.Phase.COUNTDOWN);
    if (waiting.isPresent()) {
      inLobby = true;
      lobby.run(tick, state.orElseThrow());
      return true;
    }
    if (inLobby) {
      inLobby = false;
      lobby.leave();
    }
    return false;
  }

  /** Whether {@code match} is still the session in play; it ends when rwf settles the match. */
  private boolean sameMatch(MatchSession match) {
    return roster.session().map(MatchSession::matchId).filter(match.matchId()::equals).isPresent();
  }

  /** What every bot is driven from this tick: the session it started in, its world and board. */
  private record Frame(MatchSession match, WorldSnapshot snapshot, DecisionBoard board) {}

  private void drive(BotBody bot, BotProfile profile, Frame frame) {
    if (!view.isFighting(frame.match().matchId(), bot.uuid())) {
      return;
    }
    var snapshot = frame.snapshot();
    if (bot.takeRecoveryRequest()) {
      loop.requestReplan(profile.id());
    }
    var thought = frame.board().of(profile.id());
    var self = snapshot.combatant(profile.id());
    if (self.isEmpty() || !self.orElseThrow().alive()) {
      return;
    }
    if (!roster.harness().controlled(frame.match().matchId()) && thinned(bot, profile, snapshot)) {
      return;
    }
    var epoch = loop.epoch(profile.id());
    var verdict = gate.judge(thought, profile.id(), epoch, tick);
    if (verdict.stale()) {
      loop.requestReplan(profile.id());
    }
    var decision = verdict.decision();
    staleness.record(tick - decision.snapshotTick());
    bot.followed(decision.planLabel(), tick - decision.snapshotTick());
    var percept =
        thought
            .map(BotThought::percept)
            .orElseGet(() -> new Percept(PerceptionState.EMPTY, List.of(), tick));
    var input =
        ReflexInput.of(self.orElseThrow(), snapshot, decision, percept).withGapples(gapples(bot));
    var match = frame.match();
    input = freshTarget(input, match.nav().grid());
    input = roster.harness().input(match.matchId(), input, match.nav());
    var context =
        new ReflexContext(
            match.nav().grid(),
            profile.levers(),
            bot.loadout(),
            roster.harness().controlled(match.matchId())
                ? ReflexContext.Habits.NONE
                : ReflexContext.Habits.of(profile.archetype(), profile.quirks()));
    var step = Reflex.tick(bot.reflex(), input, context, bot.random());
    bot.reflex(step.state());
    var controls =
        new com.shepherdjerred.thestorm.rwfbots.app.CombatHarness.Frame(
            match.matchId(),
            bot.uuid(),
            epoch,
            input,
            input.target().map(target -> match.ids().uuid(target.id()).orElseThrow()),
            step,
            roster.harness().active(match.matchId())
                    || (learning.active(match.matchId())
                        && input.self().kit()
                            == com.shepherdjerred.thestorm.rwfbots.domain.world.Kit.TROOPER)
                ? observations.capture(bot.uuid())
                : java.util.Optional.empty());
    var commands =
        roster.harness().active(match.matchId())
            ? roster.harness().commands(controls)
            : learning.commands(controls);
    driver.apply(bot, commands, match.ids(), tick);
  }

  /** Refreshes a previously visible target only while the current sight line remains clear. */
  static ReflexInput freshTarget(ReflexInput input, VoxelGrid grid) {
    var target =
        input
            .target()
            .map(CombatantView::id)
            .flatMap(input.snapshot()::combatant)
            .filter(CombatantView::alive)
            .filter(enemy -> Perception.hasLineOfSight(grid, input.self().eye(), enemy));
    return new ReflexInput(
        input.self(), input.snapshot(), input.decision(), target, input.gapplesLeft());
  }

  /**
   * At governor level 1 or more, a bot with no human within the isolation radius skips odd ticks.
   */
  private boolean thinned(BotBody bot, BotProfile profile, WorldSnapshot snapshot) {
    if (!governor.thinsIsolatedReflex() || (tick + profile.slot()) % 2 == 0) {
      return false;
    }
    var self = snapshot.require(profile.id());
    var radius = governor.settings().isolationRadius();
    for (var other : snapshot.combatants()) {
      var human = roster.isHuman(other.id());
      if (human && other.alive() && other.pos().distance(self.pos()) <= radius) {
        return false;
      }
    }
    return bot.profile().isPresent();
  }

  private int gapples(BotBody bot) {
    return roster.bodies().entity(bot.uuid()).map(BotTicker::countGapples).orElse(0);
  }

  private static int countGapples(Player entity) {
    var count = 0;
    var inventory = entity.getInventory();
    for (var slot = 0; slot < HOTBAR_AND_STORAGE; slot++) {
      var stack = inventory.getItem(slot);
      if (stack != null && stack.getType() == Material.GOLDEN_APPLE) {
        count += stack.getAmount();
      }
    }
    return count;
  }

  /** The 95th percentile of {@code nanos}, in milliseconds; zero when there are none. */
  static double msptP95(long[] nanos) {
    if (nanos.length == 0) {
      return 0;
    }
    var sorted = Arrays.copyOf(nanos, nanos.length);
    Arrays.sort(sorted);
    var index = Math.clamp((int) Math.ceil(0.95 * sorted.length) - 1, 0, sorted.length - 1);
    return sorted[index] / 1_000_000.0;
  }
}
