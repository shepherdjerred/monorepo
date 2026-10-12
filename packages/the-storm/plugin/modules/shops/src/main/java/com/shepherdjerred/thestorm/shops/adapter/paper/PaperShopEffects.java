package com.shepherdjerred.thestorm.shops.adapter.paper;

import com.shepherdjerred.thestorm.shops.app.ShopEffects;
import com.shepherdjerred.thestorm.shops.domain.shop.BlockPos;
import com.shepherdjerred.thestorm.shops.domain.trade.TradeRecord;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.bukkit.entity.HumanEntity;

/** Owner notices and closing shop containers, in the running server. */
final class PaperShopEffects implements ShopEffects {

  private final OwnerNoticesListener notices;
  private final ShopBlocks blocks;
  private final com.shepherdjerred.thestorm.core.protection.ManagedTrades managedTrades;

  PaperShopEffects(
      OwnerNoticesListener notices,
      ShopBlocks blocks,
      com.shepherdjerred.thestorm.core.protection.ManagedTrades managedTrades) {
    this.notices = notices;
    this.blocks = blocks;
    this.managedTrades = managedTrades;
  }

  @Override
  public boolean tradeAllowed(com.shepherdjerred.thestorm.shops.domain.shop.SignShop shop) {
    return blocks
            .block(shop.sign())
            .map(block -> managedTrades.active(block.getLocation()))
            .orElse(false)
        && shop.container().stream()
            .allMatch(
                pos ->
                    blocks
                        .block(pos)
                        .map(block -> managedTrades.active(block.getLocation()))
                        .orElse(false));
  }

  @Override
  public boolean tellOwnerIfOnline(UUID owner, TradeRecord trade) {
    return notices.tellOwnerIfOnline(owner, trade);
  }

  @Override
  public void closeViewers(List<BlockPos> containerBlocks) {
    for (var pos : containerBlocks) {
      blocks
          .block(pos)
          .flatMap(ShopBlocks::inventoryOf)
          .ifPresent(
              inventory ->
                  new ArrayList<>(inventory.getViewers()).forEach(HumanEntity::closeInventory));
    }
  }
}
