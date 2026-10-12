package com.shepherdjerred.thestorm.shops.adapter.paper;

import com.shepherdjerred.thestorm.shops.app.ShopArchive;
import com.shepherdjerred.thestorm.shops.app.ShopLocks;
import com.shepherdjerred.thestorm.shops.app.ShopRegistry;
import com.shepherdjerred.thestorm.shops.app.ShopRelocation;
import com.shepherdjerred.thestorm.shops.app.ShopStore;
import com.shepherdjerred.thestorm.shops.domain.shop.BlockPos;
import com.shepherdjerred.thestorm.shops.domain.shop.SignShop;
import java.util.ArrayList;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executor;

/** Idempotent relocation preserves original shop ids, owners, prices and item templates. */
final class ShopMoves implements ShopRelocation {
  private final ShopRegistry registry;
  private final ShopStore store;
  private final ShopLocks locks;
  private final ShopBlocks blocks;
  private final Executor mainThread;
  private final Admission admission;

  record Admission(
      org.bukkit.Server server, com.shepherdjerred.thestorm.shops.domain.shop.ShopLimits limits) {}

  record State(ShopRegistry registry, ShopStore store, ShopLocks locks) {}

  ShopMoves(State state, ShopBlocks blocks, Executor mainThread, Admission admission) {
    this.registry = state.registry();
    this.store = state.store();
    this.locks = state.locks();
    this.blocks = blocks;
    this.mainThread = mainThread;
    this.admission = admission;
  }

  @Override
  public void validateRestore(UUID owner, byte[] snapshot) {
    var saved = ShopArchive.decode(snapshot);
    if (saved.isEmpty()) {
      return;
    }
    var player = admission.server().getPlayer(owner);
    if (player == null || !registry.isReady() || !locks.idle()) {
      throw new IllegalArgumentException(
          "shop data or trades are still settling; try again shortly");
    }
    var allowed = admission.limits().allowed(ShopsPermissions.shopkeeperLevel(player));
    if (allowed == 0 || registry.ownedBy(owner) + saved.size() > allowed) {
      throw new IllegalArgumentException(
          "your current Shopkeeper level cannot support these recovered shops");
    }
  }

  @Override
  public boolean idle(Area area) {
    return registry.isReady() && locks.idle();
  }

  @Override
  public byte[] snapshot(Area area, UUID owner) {
    var selected = new ArrayList<SignShop>();
    for (var shop : registry.all()) {
      var signInside = inside(area, shop.sign());
      var containerInside = shop.container().map(pos -> inside(area, pos)).orElse(false);
      if (!signInside && !containerInside) {
        continue;
      }
      if (!signInside
          || shop.isAdmin()
          || !shop.owner().isOwnedBy(owner)
          || shop.container().stream()
              .anyMatch(
                  pos ->
                      !inside(area, pos)
                          || ShopBlocks.containerBlocks(blocks.block(pos).orElseThrow()).stream()
                              .anyMatch(half -> !inside(area, half)))) {
        throw new IllegalStateException("shop ownership or bounds cross this rental plot");
      }
      selected.add(shop);
    }
    return ShopArchive.encode(selected);
  }

  @Override
  public CompletableFuture<Void> remove(byte[] snapshot) {
    CompletableFuture<Void> chain = CompletableFuture.completedFuture(null);
    for (var shop : ShopArchive.decode(snapshot)) {
      chain =
          chain.thenComposeAsync(
              ignored -> {
                var existing = registry.byId(shop.id());
                if (existing.isPresent() && !existing.get().equals(shop)) {
                  throw new IllegalStateException("shop changed after its eviction snapshot");
                }
                return store
                    .deleteShop(shop.id())
                    .thenAcceptAsync(rows -> registry.remove(shop.id()), mainThread);
              },
              mainThread);
    }
    return chain;
  }

  @Override
  public CompletableFuture<Void> restore(byte[] snapshot, Target target) {
    CompletableFuture<Void> chain = CompletableFuture.completedFuture(null);
    for (var saved : ShopArchive.decode(snapshot)) {
      var moved =
          new SignShop(
              saved.id(),
              translated(saved.sign(), target),
              saved.container().map(pos -> translated(pos, target)),
              saved.owner(),
              saved.quantity(),
              saved.prices(),
              saved.item(),
              saved.createdAt());
      chain =
          chain.thenComposeAsync(
              ignored -> {
                var existing = registry.byId(moved.id());
                if (existing.isPresent()) {
                  if (!existing.get().equals(moved)) {
                    throw new IllegalStateException("recovered shop id is already used elsewhere");
                  }
                  return CompletableFuture.completedFuture(null);
                }
                return store
                    .saveShop(moved)
                    .thenAcceptAsync(
                        id -> {
                          var sign = blocks.block(moved.sign()).orElseThrow();
                          if (!blocks.stamp(sign, moved)) {
                            throw new IllegalStateException(
                                "recovered shop sign does not match its definition");
                          }
                          registry.add(moved);
                        },
                        mainThread);
              },
              mainThread);
    }
    return chain;
  }

  private static BlockPos translated(BlockPos pos, Target target) {
    return new BlockPos(
        target.world(),
        pos.x() + target.offsetX(),
        pos.y() + target.offsetY(),
        pos.z() + target.offsetZ());
  }

  @Override
  public CompletableFuture<Void> removePlaced(byte[] snapshot, Target target) {
    var moved =
        ShopArchive.decode(snapshot).stream()
            .map(
                saved ->
                    new SignShop(
                        saved.id(),
                        translated(saved.sign(), target),
                        saved.container().map(pos -> translated(pos, target)),
                        saved.owner(),
                        saved.quantity(),
                        saved.prices(),
                        saved.item(),
                        saved.createdAt()))
            .toList();
    return remove(ShopArchive.encode(moved));
  }

  private static boolean inside(Area area, BlockPos pos) {
    return area.contains(pos.world(), pos.x(), pos.y(), pos.z());
  }
}
