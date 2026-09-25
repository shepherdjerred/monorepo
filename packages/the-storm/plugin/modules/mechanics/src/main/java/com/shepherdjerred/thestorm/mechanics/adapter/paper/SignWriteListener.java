package com.shepherdjerred.thestorm.mechanics.adapter.paper;

import com.shepherdjerred.thestorm.core.protection.Decision;
import com.shepherdjerred.thestorm.core.protection.ProtectedAction;
import com.shepherdjerred.thestorm.core.protection.Protection;
import com.shepherdjerred.thestorm.mechanics.app.SignCreation;
import com.shepherdjerred.thestorm.mechanics.app.Writer;
import com.shepherdjerred.thestorm.mechanics.domain.sign.Feature;
import com.shepherdjerred.thestorm.mechanics.domain.sign.SignTags;
import net.kyori.adventure.text.Component;
import org.bukkit.block.Sign;
import org.bukkit.block.sign.Side;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.SignChangeEvent;

/**
 * Validates mechanism signs as they are written. An accepted sign gets its canonical tag line and
 * remembers its creator; a refused one is not written and the writer is told why.
 */
final class SignWriteListener implements Listener {

  private final SignCreation creation;
  private final Signs signs;
  private final Protection protection;

  SignWriteListener(SignCreation creation, Signs signs, Protection protection) {
    this.creation = creation;
    this.signs = signs;
    this.protection = protection;
  }

  @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
  void onSignChange(SignChangeEvent event) {
    var block = event.getBlock();
    var player = event.getPlayer();
    var lines = event.lines().stream().map(PaperGrid::plain).toList();
    var tagged = SignTags.parse(lines.get(SignTags.TAG_LINE));
    if (event.getSide() == Side.BACK) {
      tagged.ifPresent(
          mechanism -> {
            event.setCancelled(true);
            Replies.error(
                player, mechanism.feature(), "Mechanism signs are written on the front of a sign.");
          });
      return;
    }
    var grid = new PaperGrid(block.getWorld());
    var outcome =
        creation.create(PaperGrid.pos(block), PaperGrid.view(block, lines), grid, writer(event));
    switch (outcome) {
      case SignCreation.Outcome.Plain() -> {}
      case SignCreation.Outcome.Refused(Feature feature, Component reason) -> {
        event.setCancelled(true);
        Replies.error(player, feature, reason);
      }
      case SignCreation.Outcome.Accepted(var mechanism) -> {
        event.line(SignTags.TAG_LINE, Component.text(mechanism.tag()));
        if (block.getState() instanceof Sign sign) {
          signs.setOwner(sign, player.getUniqueId());
          sign.update();
        }
        Replies.success(player, mechanism.feature(), "Built. " + hint(mechanism.feature()));
      }
    }
  }

  private Writer writer(SignChangeEvent event) {
    Player player = event.getPlayer();
    var location = event.getBlock().getLocation();
    return new Writer() {
      @Override
      public boolean hasPermission(String permission) {
        return player.hasPermission(permission);
      }

      @Override
      public Decision mayBuildHere() {
        return protection.check(player.getUniqueId(), ProtectedAction.BUILD, location);
      }
    };
  }

  private static String hint(Feature feature) {
    return switch (feature) {
      case HIDDEN_SWITCH -> "Right-click the block it hangs on, from the other side.";
      case LIGHT_SWITCH -> "Right-click it to switch the lights nearby.";
      case COOKING_POT -> "Right-click it with fuel, then with food to cook.";
      case ELEVATOR -> "Right-click it to ride to the next floor.";
      case BRIDGE, DOOR, GATE ->
          "Right-click it or power it with redstone to open; holding its block adds more.";
      case MAP_CHANGER -> "Right-click it to change the maps in the frames beside it.";
      case CRUSH, BOUNCE, SUPER_STICKY, SUPER_PUSH -> "The piston beside it now works this way.";
      case BLOCK_DROPS, SIGN_COPIER, PAINTING_SWITCHER -> "";
    };
  }
}
