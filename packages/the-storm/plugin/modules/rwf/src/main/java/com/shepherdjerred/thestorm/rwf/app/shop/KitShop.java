// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/kits/KitPurchaseInventory.java); see
// packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.app.shop;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.economy.app.AccountId;
import com.shepherdjerred.thestorm.economy.app.CurrencyId;
import com.shepherdjerred.thestorm.economy.app.EconomyError;
import com.shepherdjerred.thestorm.economy.app.KeyedTransfer;
import com.shepherdjerred.thestorm.economy.app.Money;
import com.shepherdjerred.thestorm.economy.app.Receipt;
import com.shepherdjerred.thestorm.economy.app.Wallets;
import com.shepherdjerred.thestorm.rwf.domain.kit.KitLayout;
import com.shepherdjerred.thestorm.rwf.domain.kit.KitPool;
import com.shepherdjerred.thestorm.rwf.domain.kit.KitSpec;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.function.Supplier;

/**
 * Buys kits with Red Warfare credits. A purchase is written as a pending {@link Purchase} first;
 * its id is the idempotency key of the transfer from the player to the server, so the ledger moves
 * the credits at most once; only once it holds the receipt is the kit granted, in the same
 * transaction that closes the purchase. A purchase the ledger refused is cancelled. A crash in
 * between leaves the purchase pending, and {@link #replay} settles it on the next start by the
 * ledger's own record: a receipt grants the kit and no receipt cancels the purchase. So a player is
 * never charged without the kit, nor given it without paying.
 */
public final class KitShop {

  /** The currency kits are bought with. */
  public static final CurrencyId CURRENCY = CurrencyId.RWF_CREDITS;

  /**
   * How a replayed purchase was settled.
   *
   * @param purchase the purchase
   * @param granted whether the kit was granted (the ledger had taken the credits)
   */
  public record Settled(Purchase purchase, boolean granted) {}

  private final Wallets wallets;
  private final KitStore store;
  private final Supplier<UUID> ids;

  /**
   * @param wallets the economy
   * @param store owned kits and the purchase outbox
   * @param ids fresh purchase ids, from the module's randomness
   */
  public KitShop(Wallets wallets, KitStore store, Supplier<UUID> ids) {
    this.wallets = wallets;
    this.store = store;
    this.ids = ids;
  }

  public CompletableFuture<Set<String>> owned(UUID player) {
    return store.owned(player);
  }

  /** What {@code player} keeps between matches: their last kit and saved layouts. */
  public CompletableFuture<KitPrefs> prefs(UUID player) {
    return store.prefs(player);
  }

  /** Saves {@code layout} as {@code player}'s layout for {@code kit}. */
  public CompletableFuture<Void> saveLayout(UUID player, String kit, KitLayout layout) {
    return store.saveLayout(player, kit, layout);
  }

  public CompletableFuture<Money> balance(UUID player) {
    return wallets.balance(new AccountId.Player(player), CURRENCY);
  }

  /** {@code player} buys {@code kit} from {@code pool} at {@code now}: the purchase, or why not. */
  public CompletableFuture<Result<Purchase, ShopError>> buy(
      UUID player, KitPool pool, KitSpec kit, Instant now) {
    if (!kit.purchasable() || !pool.allows(kit.id())) {
      return CompletableFuture.completedFuture(Result.err(new ShopError.NotForSale(kit.id())));
    }
    var purchase = new Purchase(ids.get(), player, kit.id(), kit.price(), now);
    return store
        .owned(player)
        .thenCompose(
            owned -> {
              if (owned.contains(kit.id())) {
                return CompletableFuture.completedFuture(
                    Result.<Purchase, ShopError>err(new ShopError.AlreadyOwned(kit.id())));
              }
              return store
                  .begin(purchase)
                  .thenCompose(
                      opened -> opened ? charge(purchase, now) : resume(player, kit.id(), now));
            });
  }

  /** A committed charge can finish its grant on retry without waiting for a server restart. */
  private CompletableFuture<Result<Purchase, ShopError>> resume(
      UUID player, String kit, Instant now) {
    return store
        .pending()
        .thenCompose(
            pending -> {
              var previous =
                  pending.stream()
                      .filter(
                          purchase ->
                              purchase.player().equals(player) && purchase.kit().equals(kit))
                      .findFirst();
              if (previous.isEmpty()) {
                return CompletableFuture.completedFuture(Result.err(new ShopError.InProgress(kit)));
              }
              var purchase = previous.orElseThrow();
              return wallets
                  .receiptFor(purchase.id())
                  .thenCompose(
                      receipt ->
                          receipt.isPresent()
                              ? store
                                  .grant(purchase.id(), now)
                                  .thenApply(ignored -> Result.<Purchase, ShopError>ok(purchase))
                              : CompletableFuture.completedFuture(
                                  Result.err(new ShopError.InProgress(kit))));
            });
  }

  private CompletableFuture<Result<Purchase, ShopError>> charge(Purchase purchase, Instant now) {
    return wallets
        .transferOnce(transfer(purchase))
        .thenCompose(
            result ->
                switch (result) {
                  case Result.Ok<Receipt, EconomyError> _ ->
                      store
                          .grant(purchase.id(), now)
                          .thenApply(ignored -> Result.<Purchase, ShopError>ok(purchase));
                  case Result.Err<Receipt, EconomyError>(
                          EconomyError.InsufficientFunds(var _, var balance, var required)) ->
                      store
                          .cancel(purchase.id(), now)
                          .thenApply(
                              ignored ->
                                  Result.<Purchase, ShopError>err(
                                      new ShopError.TooPoor(required.amount(), balance.amount())));
                  case Result.Err<Receipt, EconomyError>(var error) ->
                      throw new IllegalStateException("a kit purchase was refused: " + error);
                });
  }

  private static KeyedTransfer transfer(Purchase purchase) {
    return new KeyedTransfer(
        purchase.id(),
        new AccountId.Player(purchase.player()),
        new AccountId.Server(),
        Money.of(CURRENCY, purchase.price()),
        purchase.reason());
  }

  /**
   * Settles every purchase a crash left pending, by the ledger's record of its transfer: granted
   * when the credits were taken, cancelled when they never were. Run before any new purchase.
   */
  public CompletableFuture<List<Settled>> replay(Instant now) {
    return store
        .pending()
        .thenCompose(
            pending -> {
              CompletableFuture<List<Settled>> chain =
                  CompletableFuture.completedFuture(new ArrayList<>());
              for (var purchase : pending) {
                chain = chain.thenCompose(settled -> settle(purchase, now, settled));
              }
              return chain.thenApply(List::copyOf);
            });
  }

  private CompletableFuture<List<Settled>> settle(
      Purchase purchase, Instant now, List<Settled> settled) {
    return wallets
        .receiptFor(purchase.id())
        .thenCompose(
            receipt -> {
              var granted = receipt.isPresent();
              var write =
                  granted ? store.grant(purchase.id(), now) : store.cancel(purchase.id(), now);
              return write.thenApply(
                  ignored -> {
                    settled.add(new Settled(purchase, granted));
                    return settled;
                  });
            });
  }
}
