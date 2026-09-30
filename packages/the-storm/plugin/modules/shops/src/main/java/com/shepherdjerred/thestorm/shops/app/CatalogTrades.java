package com.shepherdjerred.thestorm.shops.app;

import static java.util.concurrent.CompletableFuture.completedFuture;

import com.shepherdjerred.thestorm.economy.app.AccountId;
import com.shepherdjerred.thestorm.economy.app.Crystals;
import com.shepherdjerred.thestorm.shops.domain.catalog.Catalog;
import com.shepherdjerred.thestorm.shops.domain.catalog.CatalogEntry;
import com.shepherdjerred.thestorm.shops.domain.catalog.DailyAllowance;
import com.shepherdjerred.thestorm.shops.domain.trade.Direction;
import com.shepherdjerred.thestorm.shops.domain.trade.TradeProblem;
import com.shepherdjerred.thestorm.shops.domain.trade.TradeRecord;
import com.shepherdjerred.thestorm.shops.domain.trade.TradeSite;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.OptionalInt;
import java.util.Set;
import java.util.concurrent.CompletableFuture;

/**
 * Trading with the NPC catalogs: the server account is always the other side, so stock and room
 * never run out; per-player daily limits cap how much a player moves each day. Main thread only.
 */
public final class CatalogTrades {

  private final Map<String, Catalog> catalogs;
  private final ChestShops.Wiring wiring;
  private final DailyUsage usage;
  private final int maxLots;

  /**
   * @param catalogs the validated catalogs, in menu order
   * @param wiring the shared collaborators
   * @param usage today's counts per player, for the daily limits
   * @param maxLots the most trades one purchase may bundle
   */
  public CatalogTrades(
      List<Catalog> catalogs, ChestShops.Wiring wiring, DailyUsage usage, int maxLots) {
    var byId = new LinkedHashMap<String, Catalog>();
    for (var catalog : catalogs) {
      if (byId.putIfAbsent(catalog.id(), catalog) != null) {
        throw new IllegalArgumentException("two catalogs use the id " + catalog.id());
      }
    }
    this.catalogs = byId;
    this.wiring = wiring;
    this.usage = usage;
    this.maxLots = maxLots;
  }

  /**
   * A request to trade with a catalog.
   *
   * @param catalog the catalog
   * @param entry one of its entries
   * @param direction buying or selling
   * @param lots how many of the entry's trades at once, 1..{@link #maxLots()}
   * @param customer who is trading
   * @param customerItems their inventory
   */
  public record Order(
      Catalog catalog,
      CatalogEntry entry,
      Direction direction,
      int lots,
      Customer customer,
      Holdings customerItems) {}

  public Optional<Catalog> catalog(String id) {
    return Optional.ofNullable(catalogs.get(id));
  }

  public Set<String> ids() {
    return Set.copyOf(catalogs.keySet());
  }

  public int maxLots() {
    return maxLots;
  }

  /**
   * How many more items the customer may trade in {@code direction} today, or empty when the entry
   * has no daily limit.
   */
  public CompletableFuture<OptionalInt> remainingToday(
      Catalog catalog, CatalogEntry entry, Direction direction, Customer customer) {
    if (entry.dailyLimit().isEmpty()) {
      return completedFuture(OptionalInt.empty());
    }
    return allowance(catalog, entry, direction, customer)
        .thenApply(allowance -> OptionalInt.of(allowance.remaining()));
  }

  /** Trades {@code order.lots()} lots with the catalog. */
  public CompletableFuture<TradeOutcome> trade(Order order) {
    if (order.lots() < 1 || order.lots() > maxLots) {
      throw new IllegalArgumentException("lots must be 1.." + maxLots + ": " + order.lots());
    }
    var price = order.entry().prices().forDirection(order.direction());
    if (price.isEmpty()) {
      return completedFuture(
          new TradeOutcome.Refused(new TradeProblem.NotOffered(order.direction())));
    }
    var quantity = Math.multiplyExact(order.entry().quantity(), order.lots());
    var deal =
        new Deal(
            order.direction(),
            quantity,
            Crystals.of(price.orElseThrow().times(order.lots())),
            new Deal.Party(order.customer().account(), order.customerItems()),
            new Deal.Party(new AccountId.Server(), Holdings.UNLIMITED),
            "shop:catalog:"
                + order.catalog().id()
                + ":"
                + order.entry().itemKey()
                + ":"
                + order.direction().id(),
            order.entry().itemKey());
    var goods = TradeEngine.goodsProblem(deal);
    if (goods.isPresent()) {
      return completedFuture(new TradeOutcome.Refused(goods.orElseThrow()));
    }
    var lease = wiring.locks().acquire(List.of(), order.customer().id(), deal);
    if (lease.isEmpty()) {
      return completedFuture(new TradeOutcome.Refused(new TradeProblem.Busy()));
    }
    CompletableFuture<TradeOutcome> trade;
    try {
      trade =
          withinLimit(order, quantity)
              .thenComposeAsync(
                  problem ->
                      problem
                          .<CompletableFuture<TradeOutcome>>map(
                              refusal -> completedFuture(new TradeOutcome.Refused(refusal)))
                          .orElseGet(
                              () -> wiring.engine().execute(deal, lease.orElseThrow().trail())),
                  wiring.mainThread());
    } catch (RuntimeException e) {
      lease.orElseThrow().release();
      return CompletableFuture.failedFuture(e);
    }
    // Counted and logged before the lease is released, so the customer's next trade sees it. A log
    // write that fails is logged; the in-memory count still holds until the day ends.
    return lease
        .orElseThrow()
        .releaseAfter(
            trade,
            completed -> {
              usage.add(order.customer().id(), key(order), quantity);
              journal(order, quantity, deal.price());
            },
            wiring.mainThread());
  }

  /**
   * Whether today's allowance covers the trade. The customer's counts are loaded even for an entry
   * without a limit, so the count this trade adds lands on a day already read from the log.
   */
  private CompletableFuture<Optional<TradeProblem>> withinLimit(Order order, int quantity) {
    var limit = order.entry().dailyLimit();
    return usage
        .used(order.customer().id(), key(order))
        .thenApply(
            used -> {
              if (limit.isEmpty()) {
                return Optional.empty();
              }
              var allowance = new DailyAllowance(limit.getAsInt(), used);
              return allowance.permits(quantity)
                  ? Optional.empty()
                  : Optional.of(
                      new TradeProblem.DailyLimitReached(allowance.remaining(), quantity));
            });
  }

  private CompletableFuture<DailyAllowance> allowance(
      Catalog catalog, CatalogEntry entry, Direction direction, Customer customer) {
    var limit = entry.dailyLimit().orElseThrow();
    return usage
        .used(customer.id(), new ShopStore.UsageKey(catalog.id(), entry.itemKey(), direction))
        .thenApply(used -> new DailyAllowance(limit, used));
  }

  private static ShopStore.UsageKey key(Order order) {
    return new ShopStore.UsageKey(order.catalog().id(), order.entry().itemKey(), order.direction());
  }

  private void journal(Order order, int quantity, Crystals price) {
    var trade =
        new TradeRecord(
            new TradeSite.Catalog(order.catalog().id()),
            order.customer().id(),
            order.customer().name(),
            order.direction(),
            order.entry().itemKey(),
            quantity,
            price.amount(),
            wiring.time().instant());
    Background.logFailure(
        wiring.store().recordTrade(trade, true),
        wiring.logger(),
        "log a trade with catalog " + order.catalog().id());
  }
}
