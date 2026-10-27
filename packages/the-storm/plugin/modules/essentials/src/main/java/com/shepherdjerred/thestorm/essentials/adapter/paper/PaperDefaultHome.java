package com.shepherdjerred.thestorm.essentials.adapter.paper;

import com.shepherdjerred.thestorm.core.home.DefaultHome;
import com.shepherdjerred.thestorm.core.protection.Decision;
import com.shepherdjerred.thestorm.core.protection.ProtectedAction;
import com.shepherdjerred.thestorm.core.protection.Protection;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.core.world.SealedWorlds;
import com.shepherdjerred.thestorm.essentials.app.store.HomeStore;
import com.shepherdjerred.thestorm.essentials.domain.home.Home;
import com.shepherdjerred.thestorm.essentials.domain.home.HomeRules;
import com.shepherdjerred.thestorm.essentials.domain.place.Position;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.bukkit.Location;

/** Sets the default home through the same rules as {@code /sethome}, and only when none exists. */
final class PaperDefaultHome implements DefaultHome {

  private final HomeStore homes;
  private final Protection protection;
  private final SealedWorlds sealed;
  private final int limit;

  PaperDefaultHome(HomeStore homes, Protection protection, SealedWorlds sealed, int limit) {
    this.homes = homes;
    this.protection = protection;
    this.sealed = sealed;
    this.limit = limit;
  }

  @Override
  public CompletableFuture<Boolean> setIfAbsent(UUID player, Location where) {
    var world = where.getWorld();
    if (world == null || sealed.isSealed(world)) {
      return CompletableFuture.completedFuture(false);
    }
    if (protection.check(player, ProtectedAction.SET_HOME, where) instanceof Decision.Denied) {
      return CompletableFuture.completedFuture(false);
    }
    var position =
        new Position(
            world.getName(),
            where.getX(),
            where.getY(),
            where.getZ(),
            where.getYaw(),
            where.getPitch());
    return homes
        .homes(player)
        .thenCompose(
            existing -> {
              var taken =
                  existing.stream().anyMatch(home -> home.name().equals(HomeRules.DEFAULT_NAME));
              if (taken) {
                return CompletableFuture.completedFuture(false);
              }
              return homes
                  .set(player, new Home(HomeRules.DEFAULT_NAME, position), limit)
                  .thenApply(result -> result instanceof Result.Ok<?, ?>);
            });
  }
}
