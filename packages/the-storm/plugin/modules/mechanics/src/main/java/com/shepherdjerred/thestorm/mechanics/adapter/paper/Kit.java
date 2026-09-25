package com.shepherdjerred.thestorm.mechanics.adapter.paper;

import com.shepherdjerred.thestorm.core.schedule.Scheduler;
import com.shepherdjerred.thestorm.mechanics.app.Gatekeeper;
import com.shepherdjerred.thestorm.mechanics.domain.config.MechanicsConfig;
import com.shepherdjerred.thestorm.mechanics.domain.sign.Feature;
import java.util.Optional;
import java.util.UUID;
import org.bukkit.block.Sign;
import org.bukkit.entity.Player;

/**
 * What every listener shares.
 *
 * @param config the parsed {@code mechanics.yml}
 * @param gatekeeper feature switches and track levels
 * @param signs mechanism sign data
 * @param guard land protection
 * @param scheduler main-thread scheduling
 */
record Kit(
    MechanicsConfig config, Gatekeeper gatekeeper, Signs signs, Guard guard, Scheduler scheduler) {

  /**
   * What a player is told about a mechanism sign with no recorded creator, such as a CraftBook sign
   * from the old world. Editing the sign runs creation again, which records its creator.
   */
  static final String NOT_SET_UP =
      "This sign isn't set up yet. Sneak and right-click it with an empty hand, then press Done"
          + " to set it up.";

  /**
   * Whether {@code player} may use {@code feature}'s sign, telling them why not. A sign with no
   * recorded creator was not built through this plugin and must be rewritten first.
   */
  Optional<UUID> admit(Player player, Feature feature, Sign sign) {
    var refusal = gatekeeper.mayUse(feature, player::hasPermission);
    if (refusal.isPresent()) {
      Replies.error(player, feature, refusal.orElseThrow());
      return Optional.empty();
    }
    var owner = signs.owner(sign);
    if (owner.isEmpty()) {
      Replies.error(player, feature, NOT_SET_UP);
    }
    return owner;
  }
}
