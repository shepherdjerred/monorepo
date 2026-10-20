package com.shepherdjerred.thestorm.rwfbots.adapter.paper;

import com.shepherdjerred.thestorm.rwf.app.ActionRefusal;
import com.shepherdjerred.thestorm.rwfbots.app.BotProfile;
import com.shepherdjerred.thestorm.rwfbots.app.Director;
import com.shepherdjerred.thestorm.rwfbots.app.Loadouts;
import com.shepherdjerred.thestorm.rwfbots.app.PersonalityStats;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Facing;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.Loadout;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.MotionRecovery;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.ReflexState;
import java.util.Map;
import java.util.Optional;
import java.util.SplittableRandom;
import java.util.TreeMap;
import java.util.UUID;
import org.jspecify.annotations.Nullable;

/**
 * One bot the roster handed to the match, from draft to despawn: who it is, how it plays, and the
 * main-thread state its reflex layer carries between ticks. Main thread only.
 */
public final class BotBody {

  private final UUID uuid;
  private final Director.Drafted drafted;
  private final Loadout loadout;
  private @Nullable BotProfile profile;
  private ReflexState reflex = ReflexState.initial(Facing.SOUTH);
  private MotionRecovery.State motion = MotionRecovery.State.INITIAL;
  private SplittableRandom random = new SplittableRandom(0);
  private PersonalityStats.Tally tally = PersonalityStats.Tally.NONE;
  private long drawStart = -1;
  private Optional<ActionRefusal> lastRefusal = Optional.empty();
  private int refusals;
  private String planLabel = "-";
  private long decisionAge;
  private boolean recoveryRequested;
  private Optional<String> lastMovementProblem = Optional.empty();
  private long lastMovementProblemTick = -1;
  private long nextMovementRecovery;
  private int movementRecoveries;
  private final Map<String, Integer> movementProblemsThisLife = new TreeMap<>();
  private Optional<String> lastStuck = Optional.empty();
  private long lastStuckTick = -1;
  private long nextStreak;
  private long shieldUntil;

  long shieldUntil() {
    return shieldUntil;
  }

  void shieldUntil(long tick) {
    shieldUntil = tick;
  }

  BotBody(UUID uuid, Director.Drafted drafted) {
    this.uuid = uuid;
    this.drafted = drafted;
    this.loadout = Loadouts.rwf(drafted.kit());
  }

  public UUID uuid() {
    return uuid;
  }

  public Director.Drafted drafted() {
    return drafted;
  }

  public String personalityId() {
    return drafted.personality().id();
  }

  public String name() {
    return drafted.personality().name();
  }

  public Loadout loadout() {
    return loadout;
  }

  /** The earliest tick the bot may call in its next killstreak reward. */
  long nextStreak() {
    return nextStreak;
  }

  void nextStreak(long tick) {
    nextStreak = tick;
  }

  /** The match profile, once the bot has a team and the match is live. */
  public Optional<BotProfile> profile() {
    return Optional.ofNullable(profile);
  }

  void profile(BotProfile assigned, long seed) {
    profile = assigned;
    random = new SplittableRandom(seed);
    reflex = ReflexState.initial(Facing.SOUTH);
    motion = MotionRecovery.State.INITIAL;
    recoveryRequested = false;
    clearMovementProblems();
    tally = PersonalityStats.Tally.NONE;
    drawStart = -1;
    shieldUntil = 0;
  }

  void leaveMatch() {
    profile = null;
    shieldUntil = 0;
  }

  ReflexState reflex() {
    return reflex;
  }

  void reflex(ReflexState next) {
    reflex = next;
  }

  MotionRecovery.State motion() {
    return motion;
  }

  void motion(MotionRecovery.State next) {
    motion = next;
  }

  void requestRecovery() {
    recoveryRequested = true;
  }

  /**
   * Rate-limited navigation recovery keeps persistent failures visible without flooding thinkers.
   */
  void requestMovementRecovery(String reason, long tick) {
    movementProblemsThisLife.merge(reason.split(":", 2)[0], 1, Integer::sum);
    lastMovementProblem = Optional.of(reason);
    lastMovementProblemTick = tick;
    if (tick >= nextMovementRecovery) {
      requestRecovery();
      movementRecoveries++;
      nextMovementRecovery = tick + MotionRecovery.STUCK_TICKS;
    }
  }

  public Optional<String> lastMovementProblem() {
    return lastMovementProblem;
  }

  public long lastMovementProblemTick() {
    return lastMovementProblemTick;
  }

  /** The body's state the last time it refused or stalled on a step this life. */
  void noteStuck(String state, long tick) {
    lastStuck = Optional.of(state);
    lastStuckTick = tick;
  }

  public Optional<String> lastStuck() {
    return lastStuck;
  }

  public long lastStuckTick() {
    return lastStuckTick;
  }

  /** Ticks with each kind of movement problem this life (BLOCKED, STALLED, UNREACHABLE...). */
  public Map<String, Integer> movementProblemsThisLife() {
    return Map.copyOf(movementProblemsThisLife);
  }

  public int movementRecoveries() {
    return movementRecoveries;
  }

  private void clearMovementProblems() {
    lastMovementProblem = Optional.empty();
    lastMovementProblemTick = -1;
    nextMovementRecovery = 0;
    movementRecoveries = 0;
  }

  boolean takeRecoveryRequest() {
    var requested = recoveryRequested;
    recoveryRequested = false;
    clearMovementProblems();
    return requested;
  }

  /** The reflex layer's random source, deterministic per life. */
  SplittableRandom random() {
    return random;
  }

  /** A new life: the reflex starts over looking along {@code facing}. */
  void newLife(Facing facing) {
    movementProblemsThisLife.clear();
    lastStuck = Optional.empty();
    lastStuckTick = -1;
    reflex = ReflexState.initial(facing);
    motion = MotionRecovery.State.INITIAL;
    recoveryRequested = false;
    drawStart = -1;
    shieldUntil = 0;
  }

  public PersonalityStats.Tally tally() {
    return tally;
  }

  void tally(PersonalityStats.Tally next) {
    tally = next;
  }

  long drawStart() {
    return drawStart;
  }

  void drawStart(long tick) {
    drawStart = tick;
  }

  public Optional<ActionRefusal> lastRefusal() {
    return lastRefusal;
  }

  public int refusals() {
    return refusals;
  }

  void refused(ActionRefusal refusal) {
    lastRefusal = Optional.of(refusal);
    refusals++;
  }

  public String planLabel() {
    return planLabel;
  }

  public long decisionAge() {
    return decisionAge;
  }

  void followed(String label, long age) {
    planLabel = label;
    decisionAge = age;
  }
}
