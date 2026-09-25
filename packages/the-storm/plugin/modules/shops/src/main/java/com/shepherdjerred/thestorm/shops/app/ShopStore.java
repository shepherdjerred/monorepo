package com.shepherdjerred.thestorm.shops.app;

import com.shepherdjerred.thestorm.shops.domain.shop.ItemFingerprint;
import com.shepherdjerred.thestorm.shops.domain.shop.SignShop;
import com.shepherdjerred.thestorm.shops.domain.trade.Direction;
import com.shepherdjerred.thestorm.shops.domain.trade.TradeRecord;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/**
 * Shop storage. Futures complete off the main thread; hop back with the scheduler before touching
 * the world.
 */
public interface ShopStore {

  CompletableFuture<List<SignShop>> loadShops();

  /** Stores a new shop; completes with its id. */
  CompletableFuture<Long> saveShop(SignShop shop);

  /** Sets the item a {@code ?} shop trades; completes with the rows changed. */
  CompletableFuture<Integer> setItem(long shopId, ItemFingerprint item);

  /** Removes a shop; its trades stay in the log. Completes with the rows removed. */
  CompletableFuture<Integer> deleteShop(long shopId);

  /** Logs a completed trade; completes with its log id. */
  CompletableFuture<Long> recordTrade(TradeRecord trade, boolean ownerNotified);

  /**
   * The chest-shop trades {@code owner} has not been told about, oldest first, marked as told in
   * the same transaction so a summary is never shown twice.
   */
  CompletableFuture<List<TradeRecord>> takeUnnotified(UUID owner);

  /**
   * How many items {@code customer} has traded with the catalogs since {@code since}, per catalog,
   * item and direction, for the daily limits.
   */
  CompletableFuture<Map<UsageKey, Integer>> catalogUsageSince(UUID customer, Instant since);

  /** The highest shop id ever issued, deleted shops included; 0 if none. */
  CompletableFuture<Long> lastShopId();

  /** Logs a refund the ledger refused, for staff to settle; completes with its id. */
  CompletableFuture<Long> recordRefundFailure(RefundFailure failure);

  /**
   * What a daily limit counts.
   *
   * @param catalogId the catalog
   * @param itemKey the item key
   * @param direction buying or selling, counted separately
   */
  record UsageKey(String catalogId, String itemKey, Direction direction) {}
}
