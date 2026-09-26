package com.shepherdjerred.thestorm.shops.domain.trade;

import java.util.UUID;

/** Where a trade happened. */
public sealed interface TradeSite {

  /** A player's chest shop; the owner hears about it. */
  record Chest(long shopId, UUID owner) implements TradeSite {}

  /** An admin sign shop, trading with the server. */
  record Admin(long shopId) implements TradeSite {}

  /** An NPC catalog, trading with the server. */
  record Catalog(String catalogId) implements TradeSite {}
}
