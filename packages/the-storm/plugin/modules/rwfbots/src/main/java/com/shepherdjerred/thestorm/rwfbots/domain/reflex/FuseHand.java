package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import com.shepherdjerred.thestorm.rwfbots.domain.world.BombState;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;

/**
 * The bomb fuse in a bot's hand. The press that raises it is a tap, which starts an attempt;
 * holding it only continues one. A bot whose attempt lapsed while the fuse stayed up presses again,
 * but only when the bomb still calls for that work, so a defuser never re-arms the nuke it just
 * saved.
 */
final class FuseHand {

  private FuseHand() {}

  /** Whether {@code self} has the fuse selected and is holding right-click with it. */
  static boolean raised(CombatantView self, Loadout loadout) {
    return self.usingItem() && self.heldSlot() == loadout.fuseSlot();
  }

  /** Whether to tap {@code bomb} this tick: on raising the fuse, or to restart a lapsed attempt. */
  static boolean taps(boolean raised, CombatantView self, BombView bomb, Option option) {
    if (!raised) {
      return true;
    }
    return switch (bomb.state()) {
      case BombState.Arming _ -> false;
      case BombState.Defusing _ -> false;
      case BombState.Armed _ -> option == Option.DEFUSE;
      case BombState.Idle _ -> option != Option.DEFUSE && bomb.armableBy(self.team());
      case BombState.Destroyed _ -> false;
    };
  }
}
