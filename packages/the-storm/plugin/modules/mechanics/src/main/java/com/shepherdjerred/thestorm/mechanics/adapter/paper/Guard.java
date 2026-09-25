package com.shepherdjerred.thestorm.mechanics.adapter.paper;

import com.shepherdjerred.thestorm.core.protection.Decision;
import com.shepherdjerred.thestorm.core.protection.HarmTarget;
import com.shepherdjerred.thestorm.core.protection.ProtectedAction;
import com.shepherdjerred.thestorm.core.protection.Protection;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Pos;
import com.shepherdjerred.thestorm.mechanics.domain.piston.BlockMove;
import java.util.List;
import java.util.UUID;
import org.bukkit.block.Block;
import org.bukkit.entity.Enemy;
import org.bukkit.entity.Entity;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;

/** Land protection over the domain's positions. */
final class Guard {

  private final Protection protection;

  Guard(Protection protection) {
    this.protection = protection;
  }

  Decision check(UUID player, ProtectedAction action, PaperGrid grid, Pos pos) {
    return protection.check(player, action, grid.location(pos));
  }

  /** Whether {@code a} and {@code b} lie on land with the same owner. */
  boolean sameLand(PaperGrid grid, Pos a, Pos b) {
    return protection.sameLand(grid.location(a), grid.location(b));
  }

  /**
   * Whether {@code player} may both break and build at every one of {@code cells}. The first
   * refusal wins.
   */
  Decision cells(UUID player, PaperGrid grid, List<Pos> cells) {
    for (var pos : cells) {
      for (var action : List.of(ProtectedAction.BREAK, ProtectedAction.BUILD)) {
        var decision = check(player, action, grid, pos);
        if (!decision.isAllowed()) {
          return decision;
        }
      }
    }
    return Decision.allowed();
  }

  /**
   * Whether a mechanism built by {@code owner} at {@code source} may move {@code entity}: players
   * and passive creatures are asked of protection as harm, hostile monsters always may be, and
   * other entities (items, minecarts) only from land the owner may build on.
   */
  boolean mayLaunch(UUID owner, Block source, Entity entity) {
    var at = PaperGrid.at(entity);
    if (entity instanceof Enemy) {
      return true;
    }
    if (entity instanceof Player) {
      return protection.checkHarm(owner, source.getLocation(), HarmTarget.PLAYER, at).isAllowed();
    }
    if (entity instanceof LivingEntity) {
      return protection.checkHarm(owner, source.getLocation(), HarmTarget.PASSIVE, at).isAllowed();
    }
    return protection.check(owner, ProtectedAction.BUILD, at).isAllowed();
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
