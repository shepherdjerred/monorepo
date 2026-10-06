package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import java.util.Optional;

/** Remembers lack of movement across changing decisions and performs bounded escapes. */
public final class MotionRecovery {
  public static final int STUCK_TICKS = 20;
  private static final int ESCAPE_TICKS = 12;
  private static final double PROGRESS = 0.2;

  private MotionRecovery() {}

  public record State(Optional<Vec3> anchor, long progressAt, long escapingUntil, int attempts) {
    public static final State INITIAL = new State(Optional.empty(), -1, -1, 0);
  }

  public record Step(State state, Vec3 destination, boolean jump, boolean replan) {}

  public static Step tick(State state, Vec3 position, Vec3 destination, long now) {
    var heading = destination.minus(position).horizontal();
    if (heading.isZero()) {
      return new Step(State.INITIAL, destination, false, false);
    }
    if (now < state.escapingUntil()) {
      return escape(state, position, heading, false);
    }
    if (state.anchor().isEmpty()
        || state.anchor().orElseThrow().horizontalDistance(position) >= PROGRESS) {
      return new Step(new State(Optional.of(position), now, -1, 0), destination, false, false);
    }
    if (now - state.progressAt() < STUCK_TICKS) {
      return new Step(state, destination, false, false);
    }
    var next = new State(Optional.of(position), now, now + ESCAPE_TICKS, state.attempts() + 1);
    return escape(next, position, heading, true);
  }

  private static Step escape(State state, Vec3 position, Vec3 heading, boolean beginning) {
    var forward = heading.normalized();
    var sign = state.attempts() % 2 == 0 ? -1 : 1;
    var side = new Vec3(-forward.z(), 0, forward.x()).scale(sign);
    return new Step(
        state,
        position.plus(side).minus(forward.scale(0.25)),
        beginning,
        beginning && state.attempts() >= 2);
  }
}
