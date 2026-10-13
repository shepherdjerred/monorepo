// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/managers/GameManager.java, the border, and
// redwarfare-arcade/src/me/libraryaddict/arcade/game/searchanddestroy/abilities/RewinderAbility.java);
// see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.rwf.domain.ability.Ground;
import com.shepherdjerred.thestorm.rwf.domain.combat.AttackType;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Cuboid;
import com.shepherdjerred.thestorm.rwf.domain.kit.SafeTeleport;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import org.bukkit.Sound;
import org.bukkit.World;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;

/**
 * What the map does to a living fighter every tick: the square border, the void below the map, and
 * the ground the Rewind trail stands on. Main thread only.
 */
final class Battlefield {

  /** How often a fighter outside the border is hurt: once a second, as Red Warfare did. */
  static final int BORDER_EVERY_TICKS = 20;

  /** Damage a second outside the border. */
  static final double BORDER_DAMAGE = 2;

  /** How long between "You cannot explore the border!" warnings to one fighter. */
  static final Duration BORDER_WARNING = Duration.ofSeconds(4);

  /**
   * How far below the bottom of the map a fighter falls before the void takes them: the map's
   * region ends at its lowest block, and below it is nothing but the drop.
   */
  static final int VOID_MARGIN = 8;

  private final CombatTracker combat;
  private final Sacrifices sacrifices;
  private final Map<CombatantId, Instant> borderWarned = new HashMap<>();

  Battlefield(CombatTracker combat, Sacrifices sacrifices) {
    this.combat = combat;
    this.sacrifices = sacrifices;
  }

  /** A new map: nobody has been warned yet. */
  void clear() {
    borderWarned.clear();
  }

  /**
   * A fighter standing outside the map's square border (X and Z; height is free) takes {@link
   * #BORDER_DAMAGE} through armor, as Red Warfare's border did, and is warned now and then. The
   * runner calls this every {@link #BORDER_EVERY_TICKS}.
   */
  void hurtOutside(CombatantId id, Player player, Cuboid border, Instant now) {
    if (border.containsColumn(Places.vec(Places.at(player)))) {
      return;
    }
    var warned = borderWarned.get(id);
    if (warned == null || !now.isBefore(warned.plus(BORDER_WARNING))) {
      borderWarned.put(id, now);
      Texts.error(player, "You cannot explore the border!");
    }
    combat.hurt(player, AttackType.BORDER, BORDER_DAMAGE);
    player.getWorld().playSound(Places.at(player), Sound.ENTITY_PLAYER_HURT, 1, 1);
    player.setHealth(Math.max(0, player.getHealth() - BORDER_DAMAGE));
  }

  /**
   * A fighter more than {@link #VOID_MARGIN} below the map has fallen into the void and dies at
   * once, credited to whoever last knocked or shot them, if anyone did. True if they did.
   */
  boolean fellIntoVoid(CombatantId id, Player player, Cuboid border) {
    if (!border.below(Places.vec(Places.at(player)), VOID_MARGIN)) {
      return false;
    }
    combat.intoVoid(id.uuid());
    // As Red Warfare: a bonded ally knocked or shot into the void keeps falling while their
    // Sacrificial takes the void's damage for them; the plain void is never redirected.
    var last = combat.last(id.uuid());
    if (last.isPresent()
        && sacrifices.shieldVoid(
            player, last.orElseThrow().cause(), last.orElseThrow().attacker())) {
      return true;
    }
    player.setHealth(0);
    return true;
  }

  /**
   * The ground of {@code world} for one tick: Red Warfare's safe teleport, which the Rewind trail
   * asks of every spot it records and of the old spots it keeps.
   */
  static Ground ground(World world) {
    var minY = world.getMinHeight();
    return position ->
        SafeTeleport.safe(
            position.toBlock(),
            minY,
            block -> Footings.of(world.getBlockAt(block.x(), block.y(), block.z()).getType()));
  }

  /** Whether the entity stands on a solid block, independent of the client-reported flag. */
  static boolean grounded(Entity entity) {
    var below = Places.at(entity).clone().subtract(0, 0.05, 0);
    var world = entity.getWorld();
    return below.getY() >= world.getMinHeight()
        && below.getY() < world.getMaxHeight()
        && below.getBlock().getType().isSolid();
  }
}
