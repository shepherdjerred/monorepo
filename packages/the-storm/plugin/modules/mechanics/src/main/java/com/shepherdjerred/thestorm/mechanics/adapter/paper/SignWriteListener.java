package com.shepherdjerred.thestorm.mechanics.adapter.paper;

import com.shepherdjerred.thestorm.core.protection.Decision;
import com.shepherdjerred.thestorm.core.protection.ProtectedAction;
import com.shepherdjerred.thestorm.core.protection.Protection;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.mechanics.app.SignCreation;
import com.shepherdjerred.thestorm.mechanics.app.Writer;
import com.shepherdjerred.thestorm.mechanics.domain.sign.Feature;
import com.shepherdjerred.thestorm.mechanics.domain.sign.SignTags;
import java.util.Optional;
import java.util.UUID;
import net.kyori.adventure.text.Component;
import org.bukkit.block.Block;
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
  private final Structures structures;

  SignWriteListener(
      SignCreation creation, Signs signs, Protection protection, Structures structures) {
    this.creation = creation;
    this.signs = signs;
    this.protection = protection;
    this.structures = structures;
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
    var pos = PaperGrid.pos(block);
    var view = PaperGrid.view(block, lines);
    switch (creation.create(pos, view, grid, writer(event))) {
      case SignCreation.Outcome.Plain() -> record(block, Optional.empty(), Optional.empty());
      case SignCreation.Outcome.Refused(Feature feature, Component reason) -> {
        event.setCancelled(true);
        Replies.error(player, feature, reason);
      }
      case SignCreation.Outcome.Accepted(var mechanism) -> {
        var binding =
            mechanism.isStructure()
                ? structures.prepare(player.getUniqueId(), new Structures.Use(grid, pos, view))
                : Result.<Runnable, Component>ok(() -> {});
        switch (binding) {
          case Result.Err<Runnable, Component>(var reason) -> {
            event.setCancelled(true);
            Replies.error(player, mechanism.feature(), reason);
          }
          case Result.Ok<Runnable, Component>(var bind) -> {
            event.line(SignTags.TAG_LINE, Component.text(mechanism.tag()));
            record(block, Optional.of(player.getUniqueId()), Optional.of(bind));
            Replies.success(player, mechanism.feature(), "Built. " + hint(mechanism.feature()));
          }
        }
      }
    }
  }

  /**
   * Stores who created the sign (if it is a mechanism) and forgets any structure it was bound to,
   * then stores its new binding. What the sign holds is kept; it drops when the sign breaks.
   */
  private void record(Block block, Optional<UUID> creator, Optional<Runnable> bind) {
    if (!(block.getState() instanceof Sign sign)) {
      throw new IllegalStateException("a sign being written vanished at " + block);
    }
    if (creator.isEmpty() && !signs.hasBinding(sign)) {
      return;
    }
    creator.ifPresent(player -> signs.setOwner(sign, player));
    signs.clearBinding(sign);
    sign.update();
    bind.ifPresent(Runnable::run);
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
      case CRUSH, BOUNCE, SUPER_STICKY, SUPER_PUSH -> "The piston beside it now works this way.";
      case BLOCK_DROPS, SIGN_COPIER, PAINTING_SWITCHER -> "";
    };
  }
}
