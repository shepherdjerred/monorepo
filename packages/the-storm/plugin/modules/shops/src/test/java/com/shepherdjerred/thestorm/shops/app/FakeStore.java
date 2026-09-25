package com.shepherdjerred.thestorm.shops.app;

import com.shepherdjerred.thestorm.shops.domain.shop.ItemFingerprint;
import com.shepherdjerred.thestorm.shops.domain.shop.SignShop;
import com.shepherdjerred.thestorm.shops.domain.trade.TradeRecord;
import com.shepherdjerred.thestorm.shops.domain.trade.TradeSite;
import java.util.ArrayList;
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
  public CompletableFuture<Integer> catalogUsage(CatalogUsageQuery query) {
    var used =
        trades.stream()
            .map(Logged::trade)
            .filter(
                trade ->
                    trade.site() instanceof TradeSite.Catalog(var catalog)
                        && catalog.equals(query.catalogId())
                        && trade.customer().equals(query.customer())
                        && trade.material().equals(query.itemKey())
                        && trade.direction() == query.direction()
                        && !trade.at().isBefore(query.since()))
            .mapToInt(TradeRecord::quantity)
            .sum();
    return CompletableFuture.completedFuture(used);
  }

  @Override
  public CompletableFuture<Long> recordRefundFailure(RefundFailure failure) {
    refundFailures.add(failure);
    return CompletableFuture.completedFuture((long) refundFailures.size());
  }
}
