package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;

/** The bomb fuse in a bot's hand: held right-click is what arms and defuses at full speed. */
final class FuseHand {

  private FuseHand() {}

  /** Whether {@code self} has the fuse selected and is holding right-click with it. */
  static boolean raised(CombatantView self, Loadout loadout) {
    return self.usingItem() && self.heldSlot() == loadout.fuseSlot();
  }
}
