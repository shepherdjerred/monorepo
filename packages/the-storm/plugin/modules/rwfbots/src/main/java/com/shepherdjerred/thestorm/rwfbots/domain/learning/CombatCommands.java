package com.shepherdjerred.thestorm.rwfbots.domain.learning;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Facing;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.CombatFootwork;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.MovementMotor;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.Reflex;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.ReflexInput;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BodyCommand;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Stance;
import java.util.ArrayList;
import java.util.List;

/** Replaces movement and attack timing while preserving authored aim, healing and item controls. */
public final class CombatCommands {
  private CombatCommands() {}

  /**
   * Exact authored state and terrain are required; a command list cannot prove motion ownership.
   */
  public record Context(Reflex.Step authored, ReflexInput input, NavArtifact nav) {}

  public static List<BodyCommand> replace(Context context, ActionTicket ticket) {
    var authored = context.authored().commands();
    var input = context.input();
    if (!eligible(context, ticket)) return authored;
    var result = new ArrayList<BodyCommand>();
    for (var command : authored) {
      if (!(command instanceof BodyCommand.MoveToward
          || command instanceof BodyCommand.Stop
          || command instanceof BodyCommand.Jump
          || command instanceof BodyCommand.Sneak
          || command instanceof BodyCommand.Swing
          || command instanceof BodyCommand.Attack)) result.add(command);
    }
    var action = ticket.action();
    var direction = direction(ticket);
    if (direction.isZero()) result.add(new BodyCommand.Stop());
    else
      result.add(
          new BodyCommand.MoveToward(
              input.self().pos().plus(direction.normalized()), action.sprint()));
    result.add(new BodyCommand.Sneak(action.sneak()));
    if (action.jump()) result.add(new BodyCommand.Jump());
    if (action.attack()) {
      result.add(new BodyCommand.Swing());
      result.add(new BodyCommand.Attack(input.target().orElseThrow().id()));
    }
    return List.copyOf(result);
  }

  /** Whether the external sword controls will actually replace authored commands this tick. */
  public static boolean eligible(Context context) {
    var input = context.input();
    if (input.self().kit() != Kit.TROOPER
        || input.self().heldSlot() != 1
        || input.self().usingItem()
        || input.target().isEmpty()
        || authoredMotion(context)) return false;
    return context.authored().commands().stream()
        .noneMatch(
            command ->
                command instanceof BodyCommand.StartUse
                    || command instanceof BodyCommand.ReleaseUse
                    || command instanceof BodyCommand.CancelUse
                    || (command instanceof BodyCommand.SelectSlot(var slot) && slot != 1));
  }

  /** Unsafe tickets are rejected whole so applied metrics and executed action labels agree. */
  public static boolean eligible(Context context, ActionTicket ticket) {
    if (!eligible(context)) return false;
    var self = context.input().self();
    var action = ticket.action();
    if (action.sprint() && !self.traversal().maySprint()) return false;
    var direction = direction(ticket);
    if (!CombatFootwork.safe(context.nav().grid(), self, direction)) return false;
    return !action.jump()
        || CombatFootwork.safeJump(
            context.nav(),
            self,
            new MovementMotor.Control(direction, action.sprint(), self.onGround(), 1),
            context.input().snapshot().tick());
  }

  private static Vec3 direction(ActionTicket ticket) {
    var forward = new Facing(ticket.yaw(), 0).direction();
    var side = new Vec3(-forward.z(), 0, forward.x());
    return forward.scale(ticket.action().forward()).plus(side.scale(ticket.action().side()));
  }

  private static boolean authoredMotion(Context context) {
    var input = context.input();
    if (input.self().traversal().fallDistance() > 0
        || context.authored().state().activeJump().isPresent()
        || context.nav().graph().water().contains(BlockPos.of(input.self().pos()))
        || input.decision().bomb().isPresent()
        || input.decision().ability().isPresent()
        || input.decision().stance() == Stance.EVASIVE) return true;
    var waypoints = input.decision().waypoints();
    var index = context.authored().state().waypointIndex();
    if (index >= waypoints.size()) return false;
    // Planned step jumps and every drop stay authored too: waypoints carry no risk certificate.
    if (waypoints.get(index).hop() != Hop.WALK) return true;
    var target = input.target().orElseThrow();
    return !Reflex.hitTest(
        context.nav().grid(),
        input.self(),
        Facing.looking(input.self().eye(), target.pos().plus(0, 1.3, 0)),
        target);
  }
}
