package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import com.shepherdjerred.thestorm.rwfbots.domain.world.BodyCommand;
import java.util.List;
import java.util.Optional;

/**
 * When a bot eats a steak, which heals at once with no eating animation: once it has lost a whole
 * steak's worth of health, so none is wasted, and is low or was just hit in a fight. A steak goes
 * between swings: never in a tick that swings, nor while eating an apple or drawing a bow, and at
 * least the kit items' gap after the last right-click.
 */
final class SteakEating {

  private SteakEating() {}

  /** The steak to eat this tick, given the commands the tick already chose, if any. */
  static Optional<BodyCommand.Consume> choose(
      Loadout loadout, ReflexInput input, ReflexState state, List<BodyCommand> tick) {
    var now = input.snapshot().tick();
    if (!loadout.hasSteak()
        || now < state.nextKitUse()
        || state.isEating()
        || state.isDrawing()
        || tick.stream().anyMatch(SteakEating::swings)) {
      return Optional.empty();
    }
    var self = input.self();
    var max = self.traversal().maxHealth();
    if (max - self.health() < Reflex.STEAK_HEAL) {
      return Optional.empty();
    }
    var hit =
        input.target().isPresent()
            && self.lastHurtTick() >= 0
            && now - self.lastHurtTick() <= Reflex.STEAK_AFTER_HIT_TICKS;
    return self.health() <= max * Reflex.STEAK_BELOW_SHARE || hit
        ? Optional.of(new BodyCommand.Consume(loadout.steakSlot()))
        : Optional.empty();
  }

  private static boolean swings(BodyCommand command) {
    return command instanceof BodyCommand.Attack || command instanceof BodyCommand.Swing;
  }
}
