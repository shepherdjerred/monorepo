package com.shepherdjerred.thestorm.rwfbots.domain.learning;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Facing;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.ReflexInput;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BodyCommand;
import java.util.ArrayList;
import java.util.List;

/** Replaces movement and attack timing while preserving authored aim, healing and item controls. */
public final class CombatCommands {
  private CombatCommands() {}

  public static List<BodyCommand> replace(
      List<BodyCommand> authored, ReflexInput input, ActionTicket ticket) {
    if (input.self().heldSlot() != 1 || input.self().usingItem() || input.target().isEmpty())
      return authored;
    if (authored.stream()
        .anyMatch(
            command ->
                command instanceof BodyCommand.StartUse
                    || command instanceof BodyCommand.ReleaseUse
                    || command instanceof BodyCommand.CancelUse
                    || (command instanceof BodyCommand.SelectSlot(var slot) && slot != 1)))
      return authored;
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
    var forward = new Facing(ticket.yaw(), 0).direction();
    var side = new Vec3(-forward.z(), 0, forward.x());
    var direction = forward.scale(action.forward()).plus(side.scale(action.side()));
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
}
