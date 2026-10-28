package com.shepherdjerred.thestorm.shops.adapter.paper;

import com.shepherdjerred.thestorm.core.protection.ReservedContainers;
import com.shepherdjerred.thestorm.shops.app.ShopRegistry;
import org.bukkit.Location;

/** Shop containers, so a deposit bank cannot take over a shop's stock. */
public final class ShopReservations implements ReservedContainers {

  private final ShopRegistry registry;

  public ShopReservations(ShopRegistry registry) {
    this.registry = registry;
  }

  @Override
  public boolean contains(Location location) {
    var world = location.getWorld();
    if (world == null) {
      return false;
    }
    for (var pos : ShopBlocks.containerBlocks(location.getBlock())) {
      if (!registry.tradingFrom(pos).isEmpty()) {
        return true;
      }
    }
    return false;
  }
}
