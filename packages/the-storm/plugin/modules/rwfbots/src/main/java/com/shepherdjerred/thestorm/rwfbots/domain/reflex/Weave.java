package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.VoxelGrid;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Stimulus;
import java.util.random.RandomGenerator;

/**
 * Zig-zagging in on an archer with its bow drawn. An archer leads its shot on where its target is
 * heading, as bot archers do. Legs across the line flip every 6 to 9 ticks, at no beat an archer
 * can time, and a reaction time after each shot, so the arrow flies at where the last leg was
 * going. In the sim duel (ArcherDuelTest) a leading archer landed 47% of its arrows on a straight
 * charge and 29% on a weave; legs of 8 to 12 ticks let 30% land. Within six blocks an arrow arrives
 * in two ticks, before a leg can carry the body aside, and charging straight wins.
 */
final class Weave {

  /** An archer this close is charged straight: its arrow arrives within two ticks. */
  static final double NEAR = 6;

  /** An archer further than this is a long way from any fight. */
  static final double FAR = 30;

  /**
   * The weight of a leg's sideways step against the charge: legs 27 degrees off the line, which
   * cost the charge an eighth of its time. Wider legs spent longer under the bow than they saved.
   */
  static final double WEIGHT = 0.5;

  /** The shortest leg, in ticks. */
  static final int SHORTEST_LEG = 6;

  /** How much longer a leg may be, in ticks. */
  static final int LEG_SPREAD = 4;

  private Weave() {}

  /** Whether a body charging {@code target} at {@code distance} weaves. */
  static boolean applies(CombatantView target, double distance, Kit.Body body) {
    // An Inertia runs straight in: a turn costs its momentum.
    return target.drawingBow() && distance >= NEAR && distance <= FAR && body != Kit.Body.CHARGE;
  }

  /**
   * The state with its leg flipped when the leg is over, onto a leg of 6 to 9 ticks. A leg also
   * ends a reaction time after the archer looses: its arrow was led on the leg it flies at.
   */
  static ReflexState legs(ReflexState state, Loose loose, RandomGenerator random) {
    var now = loose.now();
    var end = state.nextStrafeFlip();
    if (loose.loosed()) end = Math.min(end, now + loose.reactionTicks());
    if (now < end) return state.withStrafe(state.strafeDir(), end);
    return state.withStrafe(-state.strafeDir(), now + SHORTEST_LEG + random.nextInt(LEG_SPREAD));
  }

  /**
   * One tick of a weave.
   *
   * @param grid the map, to keep legs off drops
   * @param input the tick's input
   * @param archer the archer charged
   * @param reactionTicks how long the body takes to react to a shot
   */
  record Leg(VoxelGrid grid, ReflexInput input, CombatantView archer, int reactionTicks) {}

  /** The state for this tick's leg: flipped when due ({@link #legs}), then kept off a drop. */
  static ReflexState leg(Leg leg, ReflexState state, RandomGenerator random) {
    var self = leg.input().self();
    var now = leg.input().snapshot().tick();
    var loose = new Loose(now, loosed(leg.input(), leg.archer()), leg.reactionTicks());
    var next = legs(state, loose, random);
    var radial = leg.archer().pos().minus(self.pos()).horizontal().normalized();
    return next.withStrafe(side(leg.grid(), self, radial, next.strafeDir()), next.nextStrafeFlip());
  }

  /**
   * What the body knows of the archer's shot this tick.
   *
   * @param now the tick
   * @param loosed whether the archer loosed an arrow this tick
   * @param reactionTicks how long the body takes to react to it
   */
  record Loose(long now, boolean loosed, int reactionTicks) {}

  /** Whether {@code archer} loosed an arrow this tick, as its bow's sound and motion show. */
  static boolean loosed(ReflexInput input, CombatantView archer) {
    var now = input.snapshot().tick();
    return input.snapshot().stimuli().stream()
        .anyMatch(
            stimulus ->
                stimulus.kind() == Stimulus.Kind.BOW_SHOT
                    && stimulus.tick() == now
                    && stimulus.source().filter(archer.id()::equals).isPresent());
  }

  /**
   * The side the leg runs to: the state's, when a step that way is safe ({@link
   * CombatFootwork#safe}: supported ground ahead, never towards a drop), else the other.
   */
  static int side(VoxelGrid grid, CombatantView self, Vec3 radial, int strafeDir) {
    return CombatFootwork.safe(grid, self, step(radial, strafeDir)) ? strafeDir : -strafeDir;
  }

  /** A leg's step: the charge plus the sideways component. */
  static Vec3 step(Vec3 radial, int strafeDir) {
    var side = new Vec3(-radial.z(), 0, radial.x()).scale(strafeDir);
    return side.scale(WEIGHT).plus(radial).normalized();
  }
}
