package com.shepherdjerred.thestorm.shops.app;

import com.shepherdjerred.thestorm.shops.domain.shop.BlockPos;
import com.shepherdjerred.thestorm.shops.domain.shop.SignShop;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * Every sign shop, in memory, loaded from storage when the module starts. Listeners answer "is this
 * a shop?" from here on every interaction and hopper move, so they never touch the database. Main
 * thread only; the caller persists each change.
 */
public final class ShopRegistry {

  private final Map<Long, SignShop> byId = new HashMap<>();
  private final Map<BlockPos, Long> bySign = new HashMap<>();
  private final Map<BlockPos, Set<Long>> byContainer = new HashMap<>();
  private long lastId;

  public ShopRegistry(Collection<SignShop> shops) {
    shops.forEach(this::add);
  }

  /** The id the next new shop gets. Ids are never reused. */
  public long nextId() {
    return lastId + 1;
  }

  public void add(SignShop shop) {
    if (byId.containsKey(shop.id()) || bySign.containsKey(shop.sign())) {
      throw new IllegalStateException("shop " + shop.id() + " or its sign is already registered");
    }
    byId.put(shop.id(), shop);
    bySign.put(shop.sign(), shop.id());
    shop.container()
        .ifPresent(
            container ->
                byContainer
                    .computeIfAbsent(container, key -> new LinkedHashSet<>())
                    .add(shop.id()));
    lastId = Math.max(lastId, shop.id());
  }

  /** Swaps in a changed shop with the same id, sign and container. */
  public void replace(SignShop shop) {
    var existing = byId(shop.id()).orElseThrow();
    if (!existing.sign().equals(shop.sign()) || !existing.container().equals(shop.container())) {
      throw new IllegalStateException("a shop cannot move: " + shop.id());
    }
    byId.put(shop.id(), shop);
  }

  public void remove(long id) {
    var shop = byId.remove(id);
    if (shop == null) {
      return;
    }
    bySign.remove(shop.sign());
    shop.container()
        .ifPresent(
            container -> {
              var ids = byContainer.get(container);
              if (ids != null) {
                ids.remove(id);
                if (ids.isEmpty()) {
                  byContainer.remove(container);
                }
              }
            });
  }

  public Optional<SignShop> byId(long id) {
    return Optional.ofNullable(byId.get(id));
  }

  public Optional<SignShop> atSign(BlockPos sign) {
    return Optional.ofNullable(bySign.get(sign)).flatMap(this::byId);
  }

  /** The shops trading from the container block at {@code container}. */
  public List<SignShop> tradingFrom(BlockPos container) {
    var ids = byContainer.get(container);
    if (ids == null) {
      return List.of();
    }
    var shops = new ArrayList<SignShop>(ids.size());
    for (var id : ids) {
      byId(id).ifPresent(shops::add);
    }
    return List.copyOf(shops);
  }

  /** How many chest shops {@code player} owns. */
  public int ownedBy(UUID player) {
    return (int) byId.values().stream().filter(shop -> shop.owner().isOwnedBy(player)).count();
  }

  /** The chest shops {@code player} owns. */
  public List<SignShop> shopsOf(UUID player) {
    return byId.values().stream().filter(shop -> shop.owner().isOwnedBy(player)).toList();
  }

  /**
   * Whether every shop on {@code container} belongs to {@code player}: true for a container with no
   * shops, false for one with an admin shop.
   */
  public boolean ownsAllOn(UUID player, BlockPos container) {
    return tradingFrom(container).stream().allMatch(shop -> shop.owner().isOwnedBy(player));
  }
}
