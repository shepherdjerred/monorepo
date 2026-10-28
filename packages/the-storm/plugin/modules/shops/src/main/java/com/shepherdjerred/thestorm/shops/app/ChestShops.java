package com.shepherdjerred.thestorm.shops.app;

import static java.util.concurrent.CompletableFuture.completedFuture;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.economy.app.AccountId;
import com.shepherdjerred.thestorm.economy.app.Money;
import com.shepherdjerred.thestorm.shops.domain.price.ShopLevy;
import com.shepherdjerred.thestorm.shops.domain.shop.BlockPos;
import com.shepherdjerred.thestorm.shops.domain.shop.CreationAttempt;
import com.shepherdjerred.thestorm.shops.domain.shop.CreationProblem;
import com.shepherdjerred.thestorm.shops.domain.shop.CreationRules;
import com.shepherdjerred.thestorm.shops.domain.shop.ItemFingerprint;
import com.shepherdjerred.thestorm.shops.domain.shop.ShopOwner;
import com.shepherdjerred.thestorm.shops.domain.shop.SignShop;
import com.shepherdjerred.thestorm.shops.domain.sign.OwnerLine;
import com.shepherdjerred.thestorm.shops.domain.sign.ShopSignDraft;
import com.shepherdjerred.thestorm.shops.domain.trade.Direction;
import com.shepherdjerred.thestorm.shops.domain.trade.PartialQuantity;
import com.shepherdjerred.thestorm.shops.domain.trade.TradeChecks;
import com.shepherdjerred.thestorm.shops.domain.trade.TradeProblem;
import com.shepherdjerred.thestorm.shops.domain.trade.TradeRecord;
import com.shepherdjerred.thestorm.shops.domain.trade.TradeSite;
import java.time.Duration;
import java.time.Instant;
import java.time.InstantSource;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executor;
import org.slf4j.Logger;

/**
 * Sign shops: making them, setting their item, removing them, and trading at them. Keeps the
 * in-memory registry and storage in step. Main thread only.
 */
public final class ChestShops {

  private final ShopRegistry registry;
  private final ShopStore store;
  private final ShopLocks locks;
  private final TradeEngine engine;
  private final CreationRules rules;
  private final ShopEffects effects;
  private final ServerOffers offers;
  private final Duration clickCooldown;
  private final int buyTaxPercent;
  private final int sellTaxPercent;
  private final boolean requireFullAmount;
  private final Map<UUID, Instant> lastTrades = new HashMap<>();
  private final Executor mainThread;
  private final InstantSource time;
  private final Logger logger;

  /**
   * The rules shops follow.
   *
   * @param creation the creation rules with the configured limits
   * @param offers the server's own prices, which admin shops may not loop with
   * @param clickCooldown the least time between one customer's trades at sign shops
   * @param buyTaxPercent percent of a buy kept by the server
   * @param sellTaxPercent percent of a sell kept by the server
   * @param requireFullAmount a trade must move the sign's whole quantity
   */
  public record Policy(
      CreationRules creation,
      ServerOffers offers,
      Duration clickCooldown,
      int buyTaxPercent,
      int sellTaxPercent,
      boolean requireFullAmount) {
    public Policy {
      if (clickCooldown.isNegative()) {
        throw new IllegalArgumentException("the click cooldown must not be negative");
      }
      if (buyTaxPercent < 0 || buyTaxPercent > 100 || sellTaxPercent < 0 || sellTaxPercent > 100) {
        throw new IllegalArgumentException("tax percents must be 0..100");
      }
    }

    /** No tax, and every trade must move the sign's whole quantity. */
    public Policy(CreationRules creation, ServerOffers offers, Duration clickCooldown) {
      this(creation, offers, clickCooldown, 0, 0, true);
    }
  }

  /**
   * @param wiring the shared collaborators
   * @param policy the rules shops follow
   * @param effects tells online owners about trades and closes containers while they trade
   */
  public ChestShops(Wiring wiring, Policy policy, ShopEffects effects) {
    this.registry = wiring.registry();
    this.store = wiring.store();
    this.locks = wiring.locks();
    this.engine = wiring.engine();
    this.mainThread = wiring.mainThread();
    this.time = wiring.time();
    this.logger = wiring.logger();
    this.rules = policy.creation();
    this.offers = policy.offers();
    this.clickCooldown = policy.clickCooldown();
    this.buyTaxPercent = policy.buyTaxPercent();
    this.sellTaxPercent = policy.sellTaxPercent();
    this.requireFullAmount = policy.requireFullAmount();
    this.effects = effects;
  }

  /**
   * The collaborators every shop use case shares.
   *
   * @param registry the in-memory shops
   * @param store storage
   * @param locks trades in flight
   * @param engine settles trades
   * @param mainThread completes futures on the main thread; trades settle through it
   * @param time the clock
   * @param logger for storage failures
   */
  public record Wiring(
      ShopRegistry registry,
      ShopStore store,
      ShopLocks locks,
      TradeEngine engine,
      Executor mainThread,
      InstantSource time,
      Logger logger) {}

  /**
   * A sign a player wrote, with everything the creation rules look at.
   *
   * @param draft the parsed sign
   * @param creator who wrote it
   * @param admin whether they may make admin shops
   * @param shopkeeperLevel their Shopkeeper level
   * @param where the sign, and the shop container it hangs on (if any)
   * @param item the item written on the sign, or empty for {@code ?}
   */
  public record Request(
      ShopSignDraft draft,
      Customer creator,
      boolean admin,
      int shopkeeperLevel,
      Placement where,
      Optional<ItemFingerprint> item,
      ShopOwner owner) {

    /** Admin flag, level, placement and item for a shop whose owner is implied by the sign. */
    public record Opening(
        boolean admin, int shopkeeperLevel, Placement where, Optional<ItemFingerprint> item) {}

    /** A shop for the creator, or an admin shop. A named line has to say who it resolved to. */
    public static Request implied(ShopSignDraft draft, Customer creator, Opening opening) {
      return new Request(
          draft,
          creator,
          opening.admin(),
          opening.shopkeeperLevel(),
          opening.where(),
          opening.item(),
          owner(draft, creator));
    }

    private static ShopOwner owner(ShopSignDraft draft, Customer creator) {
      return switch (draft.owner()) {
        case OwnerLine.Creator() -> new ShopOwner.Player(creator.id(), creator.name());
        case OwnerLine.AdminShop() -> new ShopOwner.Admin();
        case OwnerLine.Named(var name) ->
            throw new IllegalArgumentException("a named shop needs its owner: " + name);
      };
    }
  }

  /**
   * Where a new shop goes.
   *
   * @param sign the sign block
   * @param container the shop container the sign hangs on, if any
   * @param containerBlocks every block of that container (both halves of a double chest)
   */
  public record Placement(
      BlockPos sign, Optional<BlockPos> container, List<BlockPos> containerBlocks) {
    public Placement {
      containerBlocks = List.copyOf(containerBlocks);
    }
  }

  /** Makes the shop the sign describes, or explains every reason it cannot. */
  public Result<SignShop, List<CreationProblem>> create(Request request) {
    return switch (prepare(request)) {
      case Result.Err<SignShop, List<CreationProblem>>(var problems) -> Result.err(problems);
      case Result.Ok<SignShop, List<CreationProblem>>(var shop) -> {
        activate(shop);
        yield Result.ok(shop);
      }
    };
  }

  /** Checks a sign and builds its shop without making it tradable or persisting it. */
  public Result<SignShop, List<CreationProblem>> prepare(Request request) {
    var owner = request.owner();
    var attempt =
        new CreationAttempt(
            request.draft().owner(),
            request.admin(),
            request.shopkeeperLevel(),
            switch (owner) {
              case ShopOwner.Player(var id, _) -> registry.ownedBy(id);
              case ShopOwner.Town(var id, _) -> registry.ownedBy(id);
              case ShopOwner.Admin() -> 0;
            },
            containerState(owner, request.where()));
    var problems = rules.check(attempt);
    if (!problems.isEmpty()) {
      return Result.err(problems);
    }
    var shop =
        new SignShop(
            registry.nextId(),
            request.where().sign(),
            request.where().container(),
            owner,
            request.draft().quantity(),
            request.draft().prices(),
            request.item(),
            time.instant());
    var loop = offers.check(shop);
    if (loop.isPresent()) {
      return Result.err(List.of(loop.orElseThrow()));
    }
    return Result.ok(shop);
  }

  /** Publishes an accepted sign after the final cancellation state is known. */
  public void activate(SignShop shop) {
    registry.add(shop);
    var _ =
        store
            .saveShop(shop)
            .whenCompleteAsync(
                (id, error) -> {
                  if (error != null) {
                    logger.error("Could not save shop {}; removing it", shop.id(), error);
                    registry.remove(shop.id());
                  }
                },
                mainThread);
  }

  private CreationAttempt.Container containerState(ShopOwner owner, Placement where) {
    if (where.container().isEmpty()) {
      return CreationAttempt.Container.NONE;
    }
    var mine =
        where.containerBlocks().stream()
            .allMatch(
                block ->
                    switch (owner) {
                      case ShopOwner.Player(var id, _) -> registry.ownsAllOn(id, block);
                      case ShopOwner.Town(var id, _) -> registry.ownsAllOn(id, block);
                      case ShopOwner.Admin() ->
                          registry.tradingFrom(block).stream().allMatch(SignShop::isAdmin);
                    });
    return mine ? CreationAttempt.Container.FREE : CreationAttempt.Container.TAKEN;
  }

  /**
   * Sets the item of a {@code ?} shop, unless it is an admin shop whose prices would loop with the
   * server's for that item.
   */
  public Result<SignShop, CreationProblem> setItem(SignShop shop, ItemFingerprint item) {
    if (shop.item().isPresent()) {
      throw new IllegalStateException("shop " + shop.id() + " already has an item");
    }
    var updated = shop.withItem(item);
    var loop = offers.check(updated);
    if (loop.isPresent()) {
      return Result.err(loop.orElseThrow());
    }
    registry.replace(updated);
    Background.logFailure(
        store.setItem(shop.id(), item), logger, "save the item of shop " + shop.id());
    return Result.ok(updated);
  }

  /** Removes a shop whose sign or container was broken. */
  public void remove(SignShop shop) {
    registry.remove(shop.id());
    Background.logFailure(store.deleteShop(shop.id()), logger, "delete shop " + shop.id());
  }

  /**
   * A customer's click on a shop sign.
   *
   * @param shop the shop
   * @param direction buying or selling
   * @param customer who clicked
   * @param customerItems the customer's inventory
   * @param shopItems the shop's container, or {@link Holdings#UNLIMITED} for an admin shop
   * @param containerBlocks every block of the shop's container (both halves of a double chest),
   *     locked while the trade settles; empty for an admin shop
   */
  public record Visit(
      SignShop shop,
      Direction direction,
      Customer customer,
      Holdings customerItems,
      Holdings shopItems,
      List<BlockPos> containerBlocks,
      boolean skipTax,
      boolean tradingOwnStock) {
    public Visit {
      containerBlocks = List.copyOf(containerBlocks);
    }
  }

  /**
   * Trades one lot at a shop sign. Everything that can refuse a trade cheaply (the click cooldown,
   * a closed shop, missing goods, a payer who cannot afford it) is checked before the shop is
   * locked, so a player clicking over and over with nothing to trade never freezes the shop or
   * closes its owner's chest.
   */
  public CompletableFuture<TradeOutcome> trade(Visit visit) {
    var shop = visit.shop();
    var direction = visit.direction();
    var customer = visit.customer();
    var refusal =
        refusal(shop, direction, customer, visit.tradingOwnStock()).or(() -> tooSoon(customer));
    if (refusal.isPresent()) {
      return completedFuture(new TradeOutcome.Refused(refusal.orElseThrow()));
    }
    var price = shop.prices().forDirection(direction).orElseThrow();
    var asked = shop.quantity();
    var quantity = asked;
    if (!requireFullAmount) {
      var customerPile = visit.customerItems().stockpile();
      var shopPile = visit.shopItems().stockpile();
      var available = direction == Direction.BUY ? shopPile.count() : customerPile.count();
      var room = direction == Direction.BUY ? customerPile.space() : shopPile.space();
      var fit = PartialQuantity.fit(asked, available, room);
      if (fit < 1) {
        return completedFuture(
            new TradeOutcome.Refused(
                TradeChecks.goods(direction, asked, customerPile, shopPile).orElseThrow()));
      }
      quantity = fit;
    }
    var gross = PartialQuantity.scale(price.crystals(), asked, quantity);
    var percent =
        visit.skipTax() ? 0 : (direction == Direction.BUY ? buyTaxPercent : sellTaxPercent);
    var levy = ShopLevy.of(gross, percent);
    var deal =
        new Deal(
            direction,
            quantity,
            Money.crystals(levy.gross()),
            new Deal.Party(customer.account(), visit.customerItems()),
            new Deal.Party(accountOf(shop.owner()), visit.shopItems()),
            "shop:" + shop.id() + ":" + direction.id(),
            shop.item().orElseThrow().template(),
            levy.tax(),
            visit.tradingOwnStock());
    var goods = TradeEngine.goodsProblem(deal);
    if (goods.isPresent()) {
      return completedFuture(new TradeOutcome.Refused(goods.orElseThrow()));
    }
    return engine
        .affordability(deal)
        .thenComposeAsync(
            problem ->
                problem
                    .<CompletableFuture<TradeOutcome>>map(
                        cannot -> completedFuture(new TradeOutcome.Refused(cannot)))
                    .orElseGet(() -> settle(visit, deal, levy.gross())),
            mainThread);
  }

  /** Main thread: locks the container and customer, then settles the deal. */
  private CompletableFuture<TradeOutcome> settle(Visit visit, Deal deal, long price) {
    // Every sign on this container, and both halves of a double chest, share one lock.
    var lease = locks.acquire(visit.containerBlocks(), visit.customer().id(), deal);
    if (lease.isEmpty()) {
      return completedFuture(new TradeOutcome.Refused(new TradeProblem.Busy()));
    }
    // The shop may have been broken or closed while the affordability check was out; decide again
    // under the lock, before anything moves or the owner's view closes.
    var stillOpen = stillTrading(visit.shop());
    if (stillOpen.isPresent()) {
      lease.orElseThrow().release();
      return completedFuture(new TradeOutcome.Refused(stillOpen.orElseThrow()));
    }
    lastTrades.put(visit.customer().id(), time.instant());
    CompletableFuture<TradeOutcome> execution;
    try {
      effects.closeViewers(visit.containerBlocks());
      execution = engine.execute(deal, lease.orElseThrow().trail());
    } catch (RuntimeException e) {
      lease.orElseThrow().release();
      return CompletableFuture.failedFuture(e);
    }
    return lease
        .orElseThrow()
        .releaseAfter(
            execution,
            completed -> journal(visit.shop(), deal.direction(), visit.customer(), price),
            mainThread);
  }

  /** Why a shop that passed the first checks can no longer trade, if it cannot. */
  private Optional<TradeProblem> stillTrading(SignShop shop) {
    if (!effects.tradeAllowed(shop)) {
      return Optional.of(
          new TradeProblem.ShopClosed("the plot lease has expired or recovery is in progress."));
    }
    if (registry.byId(shop.id()).isEmpty()) {
      return Optional.of(new TradeProblem.ShopClosed("it was just removed."));
    }
    return registry.closure(shop.id()).map(TradeProblem.ShopClosed::new);
  }

  /**
   * Refuses a click too soon after the customer's last trade that got as far as settling. Refused
   * clicks do not restart the wait, so holding the button (which repeats every 200 ms) still
   * trades.
   */
  private Optional<TradeProblem> tooSoon(Customer customer) {
    var last = lastTrades.get(customer.id());
    return last != null && last.plus(clickCooldown).isAfter(time.instant())
        ? Optional.of(new TradeProblem.TooFast())
        : Optional.empty();
  }

  /** Forgets a customer who left, so the cooldown map never grows past who is online. */
  public void forget(UUID customer) {
    lastTrades.remove(customer);
  }

  /**
   * Closes every admin shop whose prices loop with the server's, for example after a catalog edit.
   * Called once the shops are loaded; each closed shop is logged loudly and listed by {@code /shop}
   * for admins.
   *
   * @return the shops closed
   */
  public List<SignShop> closeLoopingAdminShops() {
    var closedNow = new ArrayList<SignShop>();
    for (var shop : registry.all()) {
      var loop = offers.check(shop);
      if (loop.isPresent()) {
        var why = loop.orElseThrow().describe();
        registry.close(shop.id(), why);
        logger.error("Closed admin shop {} at {}: {}", shop.id(), shop.sign(), why);
        closedNow.add(shop);
      }
    }
    return List.copyOf(closedNow);
  }

  private Optional<TradeProblem> refusal(
      SignShop shop, Direction direction, Customer customer, boolean tradingOwnStock) {
    if (!effects.tradeAllowed(shop)) {
      return Optional.of(
          new TradeProblem.ShopClosed("the plot lease has expired or recovery is in progress."));
    }
    var closure = registry.closure(shop.id());
    if (closure.isPresent()) {
      return Optional.of(new TradeProblem.ShopClosed(closure.orElseThrow()));
    }
    if (shop.item().isEmpty()) {
      return Optional.of(new TradeProblem.ItemNotSet());
    }
    if (shop.owner().isOwnedBy(customer.id()) && !tradingOwnStock) {
      return Optional.of(new TradeProblem.OwnShop());
    }
    if (shop.prices().forDirection(direction).isEmpty()) {
      return Optional.of(new TradeProblem.NotOffered(direction));
    }
    return Optional.empty();
  }

  private void journal(SignShop shop, Direction direction, Customer customer, long price) {
    var site =
        switch (shop.owner()) {
          case ShopOwner.Player(var owner, _) -> new TradeSite.Chest(shop.id(), owner);
          case ShopOwner.Town(var town, _) -> new TradeSite.Chest(shop.id(), town);
          case ShopOwner.Admin() -> new TradeSite.Admin(shop.id());
        };
    var trade =
        new TradeRecord(
            site,
            customer.id(),
            customer.name(),
            direction,
            shop.item().orElseThrow().material(),
            shop.quantity(),
            price,
            time.instant());
    var told =
        switch (shop.owner()) {
          case ShopOwner.Player(var id, _) -> effects.tellOwnerIfOnline(id, trade);
          case ShopOwner.Town(_, _), ShopOwner.Admin() -> true;
        };
    Background.logFailure(
        store.recordTrade(trade, told), logger, "log a trade at shop " + shop.id());
  }

  static AccountId accountOf(ShopOwner owner) {
    return switch (owner) {
      case ShopOwner.Player(var id, _) -> new AccountId.Player(id);
      case ShopOwner.Town(var id, _) -> new AccountId.Town(id);
      case ShopOwner.Admin() -> new AccountId.Server();
    };
  }
}
