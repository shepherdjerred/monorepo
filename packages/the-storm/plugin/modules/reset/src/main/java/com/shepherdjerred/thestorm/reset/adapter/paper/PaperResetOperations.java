package com.shepherdjerred.thestorm.reset.adapter.paper;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.reset.adapter.files.VanillaPlayerReset;
import com.shepherdjerred.thestorm.reset.adapter.luckperms.LuckPermsReset;
import com.shepherdjerred.thestorm.reset.app.ResetOperations;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import net.kyori.adventure.text.Component;
import org.bukkit.Server;

/** Paper effects for a reset. {@link #kick} is always called on the main thread. */
public final class PaperResetOperations implements ResetOperations {

  private final Server server;
  private final VanillaPlayerReset vanilla;
  private final LuckPermsReset permissions;
  private final ModuleContext context;

  public PaperResetOperations(
      Server server,
      VanillaPlayerReset vanilla,
      LuckPermsReset permissions,
      ModuleContext context) {
    this.server = server;
    this.vanilla = vanilla;
    this.permissions = permissions;
    this.context = context;
  }

  @Override
  public void kick(UUID player) {
    var online = server.getPlayer(player);
    if (online != null) {
      online.getInventory().clear();
      online.getEnderChest().clear();
      online
          .getActivePotionEffects()
          .forEach(effect -> online.removePotionEffect(effect.getType()));
      online
          .getPersistentDataContainer()
          .getKeys()
          .forEach(online.getPersistentDataContainer()::remove);
      online.setLevel(0);
      online.setExp(0);
      online.setTotalExperience(0);
      online.kick(Component.text("Your player data is being reset. Please rejoin shortly."));
    }
  }

  @Override
  public CompletableFuture<Void> eraseVanilla(UUID player) {
    var erased = new CompletableFuture<Void>();
    eraseNextTick(player, erased);
    return erased;
  }

  private void eraseNextTick(UUID player, CompletableFuture<Void> erased) {
    context
        .scheduler()
        .runOnMainThread(
            () -> {
              var _ =
                  vanilla
                      .erase(player)
                      .whenComplete(
                          (ignored, failure) -> {
                            if (failure != null) {
                              erased.completeExceptionally(failure);
                            } else {
                              verifyNextTick(player, erased);
                            }
                          });
            });
  }

  private void verifyNextTick(UUID player, CompletableFuture<Void> erased) {
    // A quit save can recreate the file after deletion. Complete only when it stays absent on a
    // later tick, so hasPlayedBefore() and the first-join grants see the same fresh account.
    context
        .scheduler()
        .runOnMainThread(
            () -> {
              var _ =
                  vanilla
                      .missing(player)
                      .whenComplete(
                          (missing, failure) -> {
                            if (failure != null) {
                              erased.completeExceptionally(failure);
                            } else if (Boolean.TRUE.equals(missing)) {
                              erased.complete(null);
                            } else {
                              context
                                  .logger()
                                  .info(
                                      "Vanilla player data reappeared during reset for {}", player);
                              eraseNextTick(player, erased);
                            }
                          });
            });
  }

  @Override
  public CompletableFuture<Void> clearPermissions(UUID player) {
    return permissions.clear(player);
  }
}
