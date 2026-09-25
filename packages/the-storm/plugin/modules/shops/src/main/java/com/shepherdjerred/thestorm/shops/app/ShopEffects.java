package com.shepherdjerred.thestorm.shops.app;

import com.shepherdjerred.thestorm.shops.domain.shop.BlockPos;
import com.shepherdjerred.thestorm.shops.domain.trade.TradeRecord;
import java.util.List;
import java.util.UUID;

/** What chest shops do to the world and its players besides moving goods. Main thread only. */
public interface ShopEffects {

  /**
   * Tells {@code owner} about {@code trade} if they are online.
   *
   * @return whether they were told; if not, the trade waits for their summary on join
   */
  boolean tellOwnerIfOnline(UUID owner, TradeRecord trade);

  /**
   * Closes every open view of the container at these blocks, so nobody moves its items by hand
   * while a trade on it settles.
   */
  void closeViewers(List<BlockPos> containerBlocks);
}
