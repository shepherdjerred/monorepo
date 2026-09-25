package com.shepherdjerred.thestorm.towns.adapter.paper;

import com.shepherdjerred.thestorm.towns.domain.protection.Actor;
import java.util.UUID;
import org.bukkit.Location;
import org.bukkit.entity.Player;
import org.jspecify.annotations.Nullable;

/**
 * The player behind something that happened: who acted, whether they are online to be told, and
 * where the act came from (the player, or the pet, item or wither acting for them).
 *
 * @param id the player's id
 * @param online the player if online; offline players have no bypass and hear nothing
 * @param from where the act started
 */
record Culprit(UUID id, @Nullable Player online, Location from) {

  static Culprit of(Player player) {
    return new Culprit(player.getUniqueId(), player, Guard.position(player));
  }

  Actor actor() {
    var player = online;
    return new Actor(id, player != null && player.hasPermission(Guard.BYPASS_PERMISSION));
  }
}
