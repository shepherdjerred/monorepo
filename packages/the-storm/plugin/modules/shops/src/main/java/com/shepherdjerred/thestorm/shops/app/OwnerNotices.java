package com.shepherdjerred.thestorm.shops.app;

import com.shepherdjerred.thestorm.shops.domain.trade.TradeRecord;
import java.util.UUID;

/** Tells a chest shop's owner about a trade. Main thread only. */
@FunctionalInterface
public interface OwnerNotices {

  /**
   * Tells {@code owner} about {@code trade} if they are online.
   *
   * @return whether they were told; if not, the trade waits for their summary on join
   */
  boolean tellIfOnline(UUID owner, TradeRecord trade);
}
