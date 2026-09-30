package com.shepherdjerred.thestorm.shops.adapter.paper;

import com.shepherdjerred.thestorm.shops.app.ServerShops;
import com.shepherdjerred.thestorm.shops.app.ShopRegistry;
import java.util.Set;
import org.bukkit.Location;
import org.bukkit.entity.Player;

/** Keeps NPC catalog menus closed until stored sign shops have been reconciled. */
final class ReadyServerShops implements ServerShops {

  private final ServerShops delegate;
  private final ShopRegistry registry;

  ReadyServerShops(ServerShops delegate, ShopRegistry registry) {
    this.delegate = delegate;
    this.registry = registry;
  }

  @Override
  public void open(Player player, String catalogId, Location shopkeeper) {
    if (available(player)) {
      delegate.open(player, catalogId, shopkeeper);
    }
  }

  @Override
  public void open(Player player, String catalogId) {
    if (available(player)) {
      delegate.open(player, catalogId);
    }
  }

  @Override
  public boolean has(String catalogId) {
    return delegate.has(catalogId);
  }

  @Override
  public Set<String> catalogIds() {
    return delegate.catalogIds();
  }

  boolean isReady() {
    return registry.isReady();
  }

  private boolean available(Player player) {
    if (registry.isReady()) {
      return true;
    }
    player.sendMessage(Replies.error("Shops are still loading; try again shortly."));
    return false;
  }
}
