package com.shepherdjerred.thestorm.mechanics.adapter.paper;

import com.shepherdjerred.thestorm.core.protection.ProtectedAction;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Box;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Pos;
import com.shepherdjerred.thestorm.mechanics.domain.sign.Feature;
import com.shepherdjerred.thestorm.mechanics.domain.tools.LightSwitch;
import java.util.ArrayList;
import org.bukkit.block.data.Lightable;
import org.bukkit.entity.Player;

/**
 * Light switches: turns the configured lights near the sign on or off together, skipping lights on
 * land the player may not use.
 */
final class LightSwitches {

  private final Kit kit;

  LightSwitches(Kit kit) {
    this.kit = kit;
  }

  void flip(Player player, PaperGrid grid, Pos sign) {
    var config = kit.config().lightSwitch();
    var allowed = config.allowed();
    var lights = new ArrayList<LightSwitch.Light>();
    for (var pos : Box.around(sign, config.radius())) {
      if (!grid.contains(pos)) {
        continue;
      }
      var block = grid.block(pos);
      if (allowed.contains(PaperGrid.key(block.getType()))
          && block.getBlockData() instanceof Lightable lightable
          && kit.guard()
              .check(player.getUniqueId(), ProtectedAction.INTERACT, grid, pos)
              .isAllowed()) {
        lights.add(new LightSwitch.Light(pos, lightable.isLit()));
      }
    }
    if (lights.isEmpty()) {
      Replies.error(
          player, Feature.LIGHT_SWITCH, "No lights within " + config.radius() + " blocks.");
      return;
    }
    var flip = LightSwitch.flip(sign, lights, config.maxLights());
    for (var pos : flip.changes()) {
      var block = grid.block(pos);
      var data = (Lightable) block.getBlockData();
      data.setLit(flip.on());
      block.setBlockData(data, false);
    }
    Replies.info(player, Feature.LIGHT_SWITCH, flip.on() ? "Lights on." : "Lights off.");
  }
}
