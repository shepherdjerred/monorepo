package com.shepherdjerred.thestorm.rwfbots.domain.lobby;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Facing;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BodyCommand;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Waypoint;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * Turns a {@link LobbyPlan} into this tick's {@link BodyCommand}s, the same commands match play
 * uses: walk the path a waypoint at a time (jumping up steps), then stop and look at the plan's
 * person or glance, tap sneak or hop when the plan says so. Turning is smoothed so heads move like
 * a player's. Pure and main-thread cheap: it runs every tick for every bot in the lobby.
 */
public final class LobbySteering {

  /** A waypoint this close (horizontally) counts as reached. */
  static final double REACHED = 0.45;

  /** The most a head turns in one tick, in degrees. */
  static final double TURN_PER_TICK = 12;

  /** Ticks between two sneak toggles while tapping. */
  static final int SNEAK_TOGGLE_TICKS = 3;

  /** Ticks between two jumps. */
  static final int JUMP_COOLDOWN = 12;

  private LobbySteering() {}

  /**
   * Where a bot is in following its plan.
   *
   * @param planUntil the plan being followed, by its end tick; a new plan starts the path over
   * @param waypoint the next waypoint's index
   * @param sneaking whether the bot is sneaking now
   * @param lastToggle when sneak last changed
   * @param lastJump when the bot last jumped
   */
  public record State(
      long planUntil, int waypoint, boolean sneaking, long lastToggle, long lastJump) {

    public static final State FRESH = new State(Long.MIN_VALUE, 0, false, 0, 0);
  }

  /**
   * The bot's body this tick.
   *
   * @param feet where its feet are
   * @param onGround whether it stands on something
   * @param facing where it looks
   * @param person where the plan's person stands now, while they are still in the lobby
   */
  public record Body(Vec3 feet, boolean onGround, Facing facing, Optional<Vec3> person) {}

  /** The next state and the commands, in order. */
  public record Step(State state, List<BodyCommand> commands) {

    public Step {
      commands = List.copyOf(commands);
    }
  }

  /** One tick of following {@code plan}. */
  public static Step tick(State previous, LobbyPlan plan, Body body, long tick) {
    var commands = new ArrayList<BodyCommand>();
    var state =
        previous.planUntil() == plan.untilTick()
            ? previous
            : new State(plan.untilTick(), 0, previous.sneaking(), previous.lastToggle(), 0);
    var index = state.waypoint();
    var path = plan.path();
    while (index < path.size() && reached(body.feet(), path.get(index).pos())) {
      index++;
    }
    var lastJump = state.lastJump();
    Optional<Vec3> lookAt;
    if (index < path.size()) {
      var waypoint = path.get(index);
      commands.add(new BodyCommand.MoveToward(waypoint.pos(), waypoint.hop() == Hop.LEAP));
      var climbing =
          jumpApproach(waypoint, body.feet())
              && body.onGround()
              && tick - lastJump > JUMP_COOLDOWN / 2;
      if (climbing) {
        commands.add(new BodyCommand.Jump());
        lastJump = tick;
      }
      lookAt = Optional.of(waypoint.pos().plus(0, CombatantView.EYE_HEIGHT, 0));
    } else {
      commands.add(new BodyCommand.Stop());
      lookAt =
          body.person()
              .map(at -> at.plus(0, CombatantView.EYE_HEIGHT, 0))
              .or(() -> plan.glanceAt(tick));
      if (plan.jumps() && body.onGround() && tick - lastJump > JUMP_COOLDOWN) {
        commands.add(new BodyCommand.Jump());
        lastJump = tick;
      }
    }
    var sneak = sneak(state, plan.sneakTaps() && index >= path.size(), tick);
    sneak.command().ifPresent(commands::add);
    lookAt.ifPresent(
        at -> {
          var eye = body.feet().plus(0, CombatantView.EYE_HEIGHT, 0);
          if (at.minus(eye).length() > 0.1) {
            var turned = body.facing().turnToward(Facing.looking(eye, at), TURN_PER_TICK);
            commands.add(new BodyCommand.Look(turned.yaw(), turned.pitch()));
          }
        });
    return new Step(
        new State(plan.untilTick(), index, sneak.sneaking(), sneak.toggled(), lastJump), commands);
  }

  /** The sneak state after this tick and the command that gets there, if one is needed. */
  private record Sneak(boolean sneaking, long toggled, Optional<BodyCommand> command) {}

  private static boolean jumpApproach(Waypoint waypoint, Vec3 feet) {
    return (waypoint.hop() == Hop.JUMP || waypoint.hop() == Hop.LEAP)
        && feet.horizontalDistance(waypoint.pos()) <= (waypoint.hop() == Hop.LEAP ? 3.2 : 1.2);
  }

  private static Sneak sneak(State state, boolean tapping, long tick) {
    if (tapping && tick - state.lastToggle() >= SNEAK_TOGGLE_TICKS) {
      var next = !state.sneaking();
      return new Sneak(next, tick, Optional.of(new BodyCommand.Sneak(next)));
    }
    if (!tapping && state.sneaking()) {
      return new Sneak(false, tick, Optional.of(new BodyCommand.Sneak(false)));
    }
    return new Sneak(state.sneaking(), state.lastToggle(), Optional.empty());
  }

  private static boolean reached(Vec3 feet, Vec3 waypoint) {
    return feet.horizontalDistance(waypoint) <= REACHED && Math.abs(feet.y() - waypoint.y()) < 1.2;
  }
}
