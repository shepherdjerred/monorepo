package com.shepherdjerred.thestorm.shops.app;

import com.shepherdjerred.thestorm.shops.domain.shop.ItemFingerprint;
import com.shepherdjerred.thestorm.shops.domain.shop.SignShop;
import com.shepherdjerred.thestorm.shops.domain.trade.TradeRecord;
import com.shepherdjerred.thestorm.shops.domain.trade.TradeSite;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** Shop storage in memory, completing every future at once. */
final class FakeStore implements ShopStore {

  record Logged(TradeRecord trade, boolean notified) {}

  final Map<Long, SignShop> shops = new LinkedHashMap<>();
  final List<Logged> trades = new ArrayList<>();
  final List<RefundFailure> refundFailures = new ArrayList<>();
  boolean failSaves;
  long lastShopId;
  int usageReads;

  @Override
  public CompletableFuture<List<SignShop>> loadShops() {
    return CompletableFuture.completedFuture(List.copyOf(shops.values()));
  }

  @Override
  public CompletableFuture<Long> saveShop(SignShop shop) {
    if (failSaves) {
      return CompletableFuture.failedFuture(new IllegalStateException("disk full"));
    }
    shops.put(shop.id(), shop);
    return CompletableFuture.completedFuture(shop.id());
  }

  @Override
  public CompletableFuture<Integer> setItem(long shopId, ItemFingerprint item) {
    shops.computeIfPresent(shopId, (id, shop) -> shop.withItem(item));
    return CompletableFuture.completedFuture(1);
  }

  @Override
  public CompletableFuture<Integer> deleteShop(long shopId) {
    return CompletableFuture.completedFuture(shops.remove(shopId) == null ? 0 : 1);
  }

  @Override
  public CompletableFuture<Long> recordTrade(TradeRecord trade, boolean ownerNotified) {
    trades.add(new Logged(trade, ownerNotified));
    return CompletableFuture.completedFuture((long) trades.size());
  }

  @Override
  public CompletableFuture<List<TradeRecord>> takeUnnotified(UUID owner) {
    var taken = new ArrayList<TradeRecord>();
    for (var index = 0; index < trades.size(); index++) {
      var logged = trades.get(index);
      if (!logged.notified()
          && logged.trade().site() instanceof TradeSite.Chest(_, var shopOwner)
          && shopOwner.equals(owner)) {
        taken.add(logged.trade());
        trades.set(index, new Logged(logged.trade(), true));
      }
    }
    return CompletableFuture.completedFuture(List.copyOf(taken));
  }

  @Override
  public CompletableFuture<Map<UsageKey, Integer>> catalogUsageSince(UUID customer, Instant since) {
    usageReads++;
    var used = new HashMap<UsageKey, Integer>();
    for (var logged : trades) {
      var trade = logged.trade();
      if (trade.site() instanceof TradeSite.Catalog(var catalog)
          && trade.customer().equals(customer)
          && !trade.at().isBefore(since)) {
        used.merge(
            new UsageKey(catalog, trade.material(), trade.direction()),
            trade.quantity(),
            Integer::sum);
      }
    }
    return CompletableFuture.completedFuture(Map.copyOf(used));
  }

  @Override
  public CompletableFuture<Long> lastShopId() {
    return CompletableFuture.completedFuture(lastShopId);
  }

  @Override
  public CompletableFuture<Long> recordRefundFailure(RefundFailure failure) {
    refundFailures.add(failure);
    return CompletableFuture.completedFuture((long) refundFailures.size());
  }
}
