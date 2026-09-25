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
      Replies.error(player, feature, "This sign was never set up. Edit it to build it again.");
    }
    return owner;
  }
}
