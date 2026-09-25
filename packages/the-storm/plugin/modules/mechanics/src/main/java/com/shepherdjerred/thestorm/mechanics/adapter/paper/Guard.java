package com.shepherdjerred.thestorm.mechanics.adapter.paper;

import com.shepherdjerred.thestorm.core.protection.Decision;
import com.shepherdjerred.thestorm.core.protection.ProtectedAction;
import com.shepherdjerred.thestorm.core.protection.Protection;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Pos;
import com.shepherdjerred.thestorm.mechanics.domain.piston.BlockMove;
import com.shepherdjerred.thestorm.mechanics.domain.structure.BlockChange;
import java.util.List;
import java.util.UUID;

/** Land protection over the domain's positions. */
final class Guard {

  private final Protection protection;

  Guard(Protection protection) {
    this.protection = protection;
  }

  Decision check(UUID player, ProtectedAction action, PaperGrid grid, Pos pos) {
    return protection.check(player, action, grid.location(pos));
  }

  /**
   * Whether {@code player} may make every change: break what a change removes, build what it
   * places. The first refusal wins.
   */
  Decision changes(UUID player, PaperGrid grid, List<BlockChange> changes) {
    for (var change : changes) {
      var action = change.isRemoval() ? ProtectedAction.BREAK : ProtectedAction.BUILD;
      var decision = check(player, action, grid, change.pos());
      if (!decision.isAllowed()) {
        return decision;
      }
    }
    return Decision.allowed();
  }

  /** Whether {@code player} may break each moved block and build where it lands. */
  Decision moves(UUID player, PaperGrid grid, List<BlockMove> moves) {
    for (var move : moves) {
      var from = check(player, ProtectedAction.BREAK, grid, move.from());
      if (!from.isAllowed()) {
        return from;
      }
      var to = check(player, ProtectedAction.BUILD, grid, move.to());
      if (!to.isAllowed()) {
        return to;
      }
    }
    return Decision.allowed();
  }
}
