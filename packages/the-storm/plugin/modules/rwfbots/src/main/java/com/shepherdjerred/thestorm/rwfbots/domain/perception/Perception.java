package com.shepherdjerred.thestorm.rwfbots.domain.perception;

import static java.util.Comparator.comparingDouble;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.VoxelGrid;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Stimulus;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.util.ArrayList;
import java.util.random.RandomGenerator;

/**
 * Turns a snapshot into what one bot can tell about it. Sight needs the target inside the awareness
 * radius and field of view, in a region that can see the bot's, and one of three rays (eye, chest,
 * feet) clear of sight-blocking cells. Invisible players show only through worn armor, a fresh hit,
 * or a chance roll point blank. Disguised players pass as allies until caught. Sounds place their
 * source with an error that grows with distance.
 */
public final class Perception {

  /** Half the horizontal field of view, in degrees. */
  public static final double HALF_FOV = 70;

  /** Anything closer than this is noticed even behind the bot. */
  public static final double POINT_BLANK = 1.5;

  /** Within this distance an invisible player may be noticed by chance each tick. */
  public static final double INVISIBLE_NOTICE_RANGE = 2.0;

  /** The per-tick chance of noticing an invisible player point blank. */
  public static final double INVISIBLE_NOTICE_CHANCE = 0.25;

  /** How many ticks after a hit an invisible player's damage flash shows them. */
  public static final long HIT_FLASH_TICKS = 10;

  /** Memory time constant, in ticks: confidence drops to 1/e after ten seconds. */
  public static final double TAU_TICKS = 200;

  /** Confidence given to a heard rather than seen position. */
  public static final double SOUND_CONFIDENCE = 0.6;

  /** How close a fuse click must be to one of our bombs to count as touching it. */
  private static final double BOMB_TOUCH_RANGE = 2.5;

  private static final double CHEST_HEIGHT = 0.9;
  private static final double FEET_HEIGHT = 0.1;

  private final SenseContext context;

  public Perception(SenseContext context) {
    this.context = context;
  }

  public SenseContext context() {
    return context;
  }

  /** What {@code self} perceives of {@code snapshot}, carrying {@code state} forward. */
  public Percept perceive(
      PerceptionState state, CombatantView self, WorldSnapshot snapshot, RandomGenerator random) {
    var now = snapshot.tick();
    var suspicion = catchSpies(state.suspicion(), self, snapshot);
    var memory = state.memory();
    var visible = new ArrayList<CombatantView>();
    for (var other : snapshot.combatants()) {
      if (other.id().equals(self.id())) {
        continue;
      }
      if (!other.alive()) {
        memory = memory.forget(other.id());
        continue;
      }
      if (!isEnemy(self, other, suspicion)) {
        continue;
      }
      if (canSee(self, other, now, random)) {
        visible.add(other);
        memory = memory.remember(other.id(), new Sighting(other.pos(), other.vel(), now, 1, true));
      }
    }
    memory = hear(memory, new Frame(self, snapshot, suspicion), random);
    memory = memory.prune(now, TAU_TICKS);
    visible.sort(comparingDouble(other -> other.pos().distanceSquared(self.pos())));
    return new Percept(new PerceptionState(memory, suspicion), visible, now);
  }

  /** Whether {@code other} is, as far as {@code self} can tell, an enemy. */
  public static boolean isEnemy(CombatantView self, CombatantView other, Suspicion suspicion) {
    return !other.appearsAlliedTo(self.team()) || suspicion.isRevealed(other.id());
  }

  private boolean canSee(
      CombatantView self, CombatantView other, long now, RandomGenerator random) {
    var distance = self.pos().distance(other.pos());
    if (distance > context.levers().awarenessRadius()) {
      return false;
    }
    if (other.invisible() && !betraysInvisibility(other, distance, now, random)) {
      return false;
    }
    if (distance > POINT_BLANK && !inFieldOfView(self, other)) {
      return false;
    }
    if (!regionsMightSee(self, other)) {
      return false;
    }
    return hasLineOfSight(context.grid(), self.eye(), other);
  }

  private static boolean betraysInvisibility(
      CombatantView other, double distance, long now, RandomGenerator random) {
    if (other.armorValue() > 0) {
      return true;
    }
    if (other.lastHurtTick() >= 0 && now - other.lastHurtTick() <= HIT_FLASH_TICKS) {
      return true;
    }
    return distance <= INVISIBLE_NOTICE_RANGE && random.nextDouble() < INVISIBLE_NOTICE_CHANCE;
  }

  private static boolean inFieldOfView(CombatantView self, CombatantView other) {
    var toOther = other.eye().minus(self.eye());
    if (toOther.isZero()) {
      return true;
    }
    return self.facing().direction().angleTo(toOther) <= HALF_FOV;
  }

  private boolean regionsMightSee(CombatantView self, CombatantView other) {
    var mine = context.graph().nearestNode(self.pos());
    var theirs = context.graph().nearestNode(other.pos());
    if (mine.isEmpty() || theirs.isEmpty()) {
      return true;
    }
    var regions = context.regions();
    return regions.canSee(regions.regionOf(mine.getAsInt()), regions.regionOf(theirs.getAsInt()));
  }

  /** Whether any of the eye, chest or feet of {@code target} is visible from {@code eye}. */
  public static boolean hasLineOfSight(VoxelGrid grid, Vec3 eye, CombatantView target) {
    return grid.canSee(eye, target.eye())
        || grid.canSee(eye, target.pos().plus(0, CHEST_HEIGHT, 0))
        || grid.canSee(eye, target.pos().plus(0, FEET_HEIGHT, 0));
  }

  /** One bot's view of one tick while hearing. */
  private record Frame(CombatantView self, WorldSnapshot snapshot, Suspicion suspicion) {}

  private static Memory hear(Memory memory, Frame frame, RandomGenerator random) {
    var self = frame.self();
    var snapshot = frame.snapshot();
    var suspicion = frame.suspicion();
    var result = memory;
    for (var stimulus : snapshot.stimuli()) {
      if (stimulus.source().isEmpty()) {
        continue;
      }
      var source = snapshot.combatant(stimulus.source().get());
      if (source.isEmpty()
          || source.get().id().equals(self.id())
          || !source.get().alive()
          || !isEnemy(self, source.get(), suspicion)) {
        continue;
      }
      var distance = self.pos().distance(stimulus.pos());
      var range = stimulus.kind().range();
      if (distance > range) {
        continue;
      }
      var error = stimulus.kind().baseError() * (distance / range);
      var heard = blur(stimulus.pos(), error, random);
      result =
          result.remember(
              source.get().id(),
              new Sighting(heard, Vec3.ZERO, snapshot.tick(), SOUND_CONFIDENCE, false));
    }
    return result;
  }

  private static Vec3 blur(Vec3 pos, double error, RandomGenerator random) {
    var angle = random.nextDouble() * 2 * Math.PI;
    var radius = Math.sqrt(random.nextDouble()) * error;
    return pos.plus(StrictMath.cos(angle) * radius, 0, StrictMath.sin(angle) * radius);
  }

  /**
   * Reveals disguised enemies that hit one of ours or clicked one of our bombs this tick. Only
   * evidence within the awareness radius counts.
   */
  private Suspicion catchSpies(Suspicion suspicion, CombatantView self, WorldSnapshot snapshot) {
    var result = suspicion;
    for (var stimulus : snapshot.stimuli()) {
      if (stimulus.source().isEmpty()
          || self.pos().distance(stimulus.pos()) > context.levers().awarenessRadius()) {
        continue;
      }
      var source = snapshot.combatant(stimulus.source().get());
      if (source.isEmpty() || !isDisguisedEnemy(self, source.get())) {
        continue;
      }
      if (isEvidence(stimulus, self, snapshot)) {
        result = result.reveal(source.get().id());
      }
    }
    return result;
  }

  private static boolean isDisguisedEnemy(CombatantView self, CombatantView other) {
    return other.disguised() && !other.team().equals(self.team());
  }

  private static boolean isEvidence(Stimulus stimulus, CombatantView self, WorldSnapshot snapshot) {
    return switch (stimulus.kind()) {
      case HIT -> stimulus.victim().map(victim -> hitOurs(victim, self, snapshot)).orElse(false);
      case FUSE_CLICK ->
          snapshot.bombsOf(self.team()).stream()
              .anyMatch(bomb -> bomb.pos().distance(stimulus.pos()) <= BOMB_TOUCH_RANGE);
      case FOOTSTEP, BOW_SHOT, EAT, FUSE_HISS -> false;
    };
  }

  private static boolean hitOurs(CombatantId victim, CombatantView self, WorldSnapshot snapshot) {
    return snapshot.combatant(victim).map(view -> view.team().equals(self.team())).orElse(false);
  }
}
