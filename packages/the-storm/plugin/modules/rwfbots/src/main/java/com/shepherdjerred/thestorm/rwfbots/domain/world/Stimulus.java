package com.shepherdjerred.thestorm.rwfbots.domain.world;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import java.util.Optional;

/**
 * Something that happened this tick that a bot might hear or notice. Positions are ground truth;
 * perception blurs them by distance.
 *
 * @param kind what kind of event
 * @param pos where it happened
 * @param tick when
 * @param source who caused it, if anyone
 * @param victim who was hit, for {@link Kind#HIT}
 */
public record Stimulus(
    Kind kind, Vec3 pos, long tick, Optional<CombatantId> source, Optional<CombatantId> victim) {

  /** The kinds of event, each with how far it carries and how precisely it can be placed. */
  public enum Kind {
    FOOTSTEP(16, 3.0),
    BOW_SHOT(48, 4.0),
    HIT(32, 2.0),
    EAT(12, 2.0),
    FUSE_CLICK(24, 1.0),
    FUSE_HISS(40, 1.0);

    private final double range;
    private final double baseError;

    Kind(double range, double baseError) {
      this.range = range;
      this.baseError = baseError;
    }

    /** How far away this can be heard, in blocks. */
    public double range() {
      return range;
    }

    /** The position error at the edge of hearing range, in blocks. */
    public double baseError() {
      return baseError;
    }
  }

  public Stimulus {
    if (tick < 0) {
      throw new IllegalArgumentException("tick must not be negative");
    }
    if (victim.isPresent() && kind != Kind.HIT) {
      throw new IllegalArgumentException("only hits have a victim");
    }
  }

  public static Stimulus of(Kind kind, Vec3 pos, long tick) {
    return new Stimulus(kind, pos, tick, Optional.empty(), Optional.empty());
  }

  public static Stimulus by(Kind kind, Vec3 pos, long tick, CombatantId source) {
    return new Stimulus(kind, pos, tick, Optional.of(source), Optional.empty());
  }

  public static Stimulus hit(Vec3 pos, long tick, CombatantId attacker, CombatantId victim) {
    return new Stimulus(Kind.HIT, pos, tick, Optional.of(attacker), Optional.of(victim));
  }
}
