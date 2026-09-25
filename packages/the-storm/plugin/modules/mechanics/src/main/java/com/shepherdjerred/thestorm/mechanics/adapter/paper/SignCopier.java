package com.shepherdjerred.thestorm.mechanics.adapter.paper;

import com.shepherdjerred.thestorm.core.protection.Decision;
import com.shepherdjerred.thestorm.core.protection.ProtectedAction;
import com.shepherdjerred.thestorm.mechanics.domain.sign.Feature;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import net.kyori.adventure.text.Component;
import org.bukkit.block.Block;
import org.bukkit.block.Sign;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.block.SignChangeEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.inventory.ItemStack;

/**
 * The sign copier: punch a sign with the tool to copy the side facing you, right-click another sign
 * to paste onto the side facing you. A paste is a sign edit: it fires {@link SignChangeEvent}, so
 * pasting a mechanism tag goes through the same level, protection and structure checks as writing
 * it by hand. Only text is copied, never what a sign holds.
 */
final class SignCopier implements Listener {

  private final Kit kit;
  private final Map<UUID, List<Component>> clipboards = new HashMap<>();

  SignCopier(Kit kit) {
    this.kit = kit;
  }

  boolean isTool(ItemStack item) {
    var unlock = kit.config().signCopier().unlock();
    return unlock.enabled()
        && !item.isEmpty()
        && PaperGrid.key(item.getType()).equals(kit.config().signCopier().tool());
  }

  /** Copies the side of {@code sign} facing {@code player}; true when the click was handled. */
  boolean copy(Player player, Sign sign) {
    if (refused(player)) {
      return true;
    }
    var side = sign.getSide(sign.getInteractableSideFor(player));
    clipboards.put(player.getUniqueId(), List.copyOf(side.lines()));
    Replies.success(player, Feature.SIGN_COPIER, "Copied. Right-click a sign to paste.");
    return true;
  }

  /** Pastes onto the side of the sign at {@code block} facing {@code player}. */
  boolean paste(Player player, Block block) {
    if (refused(player)) {
      return true;
    }
    var lines = clipboards.get(player.getUniqueId());
    if (lines == null) {
      Replies.error(player, Feature.SIGN_COPIER, "Punch a sign with the tool to copy it first.");
      return true;
    }
    if (!(block.getState() instanceof Sign sign)) {
      return false;
    }
    if (sign.isWaxed()) {
      Replies.error(player, Feature.SIGN_COPIER, "That sign is waxed.");
      return true;
    }
    var grid = new PaperGrid(block.getWorld());
    var build =
        kit.guard().check(player.getUniqueId(), ProtectedAction.BUILD, grid, PaperGrid.pos(block));
    if (build instanceof Decision.Denied(var reason)) {
      Replies.error(player, Feature.SIGN_COPIER, reason);
      return true;
    }
    var side = sign.getInteractableSideFor(player);
    var edit = new SignChangeEvent(block, player, lines, side);
    player.getServer().getPluginManager().callEvent(edit);
    if (edit.isCancelled()) {
      return true;
    }
    // The edit's listeners may have stored data on the sign; paste onto a fresh copy of it.
    if (block.getState() instanceof Sign written) {
      var target = written.getSide(side);
      var pasted = edit.lines();
      for (var line = 0; line < pasted.size(); line++) {
        target.line(line, pasted.get(line));
      }
      written.update();
      Replies.success(player, Feature.SIGN_COPIER, "Pasted.");
    }
    return true;
  }

  private boolean refused(Player player) {
    var refusal = kit.gatekeeper().mayUse(Feature.SIGN_COPIER, player::hasPermission);
    refusal.ifPresent(reason -> Replies.error(player, Feature.SIGN_COPIER, reason));
    return refusal.isPresent();
  }

  @EventHandler
  void onQuit(PlayerQuitEvent event) {
    clipboards.remove(event.getPlayer().getUniqueId());
  }
}
