package com.shepherdjerred.thestorm.rwf.app;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.economy.app.AccountId;
import com.shepherdjerred.thestorm.economy.app.CurrencyId;
import com.shepherdjerred.thestorm.economy.app.EconomyError;
import com.shepherdjerred.thestorm.economy.app.KeyedTransfer;
import com.shepherdjerred.thestorm.economy.app.Money;
import com.shepherdjerred.thestorm.economy.app.Receipt;
import com.shepherdjerred.thestorm.economy.app.Wallets;
import com.shepherdjerred.thestorm.rwf.app.store.MatchStore;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/**
 * Pays match rewards, and takes the AFK penalty, in Red Warfare credits through the economy's keyed
 * transfers. Every payout is first a row in the {@link MatchStore} outbox; it moves with the
 * idempotency key {@code rwf:<matchId>:<player>}, so a replay after a crash returns the original
 * receipt instead of paying or charging twice. A row pays in the currency it was written with, so
 * rows written before Red Warfare had its own currency still settle in crystals. A charge takes no
 * more than the player holds: balances never go negative. Bots never reach this class: the rules
 * award them nothing.
 */
public final class PayoutService {

  /** The currency Red Warfare pays and charges in. */
  public static final CurrencyId CURRENCY = CurrencyId.RWF_CREDITS;

  /**
   * One payout or charge that went through the ledger.
   *
   * @param matchId the match
   * @param player who
   * @param owed what the rules awarded (negative for a charge)
   * @param paid what actually moved (negative for a charge)
   */
  public record Paid(UUID matchId, UUID player, long owed, long paid) {}

  private final Wallets wallets;
  private final MatchStore store;

  public PayoutService(Wallets wallets, MatchStore store) {
    this.wallets = wallets;
    this.store = store;
  }

  /** The idempotency key for {@code player}'s payout from {@code matchId}. */
  public static UUID key(UUID matchId, UUID player) {
    return UUID.nameUUIDFromBytes(
        ("rwf:" + matchId + ":" + player).getBytes(StandardCharsets.UTF_8));
  }

  /** The ledger reason for a payout. */
  public static String reason(UUID matchId, MatchStore.Outcome outcome) {
    return "rwf:" + matchId + ":" + outcome.name();
  }

  /** Writes the match and its players, then pays everyone owed. */
  public CompletableFuture<List<Paid>> settle(
      MatchStore.MatchRow match, List<MatchStore.PlayerRow> players) {
    return store.record(match, players).thenCompose(ignored -> payAll(players));
  }

  /** Pays every row a crash left pending or paying. */
  public CompletableFuture<List<Paid>> replay() {
    return store.unpaid().thenCompose(this::payAll);
  }

  private CompletableFuture<List<Paid>> payAll(List<MatchStore.PlayerRow> rows) {
    CompletableFuture<List<Paid>> chain = CompletableFuture.completedFuture(new ArrayList<>());
    for (var row : rows) {
      if (row.status() == MatchStore.PayoutStatus.NONE
          || row.status() == MatchStore.PayoutStatus.PAID) {
        continue;
      }
      chain =
          chain.thenCompose(
              paid ->
                  pay(row)
                      .thenApply(
                          one -> {
                            paid.add(one);
                            return paid;
                          }));
    }
    return chain.thenApply(List::copyOf);
  }

  private CompletableFuture<Paid> pay(MatchStore.PlayerRow row) {
    return store
        .beginPayout(row.matchId(), row.player())
        .thenCompose(amount -> amount < 0 ? charge(row, -amount) : transfer(row, amount))
        .thenCompose(
            moved ->
                store
                    .finishPayout(row.matchId(), row.player(), moved)
                    .thenApply(
                        ignored ->
                            new Paid(row.matchId(), row.player(), row.creditsOwed(), moved)));
  }

  private CompletableFuture<Long> transfer(MatchStore.PlayerRow row, long amount) {
    if (amount == 0) {
      return CompletableFuture.completedFuture(0L);
    }
    var request =
        new KeyedTransfer(
            key(row.matchId(), row.player()),
            new AccountId.Server(),
            new AccountId.Player(row.player()),
            Money.of(row.currency(), amount),
            reason(row.matchId(), row.outcome()));
    return wallets
        .transferOnce(request)
        .thenApply(
            result ->
                switch (result) {
                  case Result.Ok<Receipt, EconomyError>(var receipt) -> receipt.amount().amount();
                  case Result.Err<Receipt, EconomyError>(var error) ->
                      throw new IllegalStateException(
                          "the server account refused a match payout: " + error);
                });
  }

  /**
   * Takes up to {@code most} from the player, once: a committed charge is found by its key, and
   * otherwise what they hold now (at most {@code most}) is taken. Returns the negative amount
   * taken.
   */
  private CompletableFuture<Long> charge(MatchStore.PlayerRow row, long most) {
    var key = key(row.matchId(), row.player());
    var account = new AccountId.Player(row.player());
    return wallets
        .receiptFor(key)
        .thenCompose(
            committed -> {
              if (committed.isPresent()) {
                return CompletableFuture.completedFuture(-committed.get().amount().amount());
              }
              return wallets
                  .balance(account, row.currency())
                  .thenCompose(held -> take(row, key, account, Math.min(most, held.amount())));
            });
  }

  private CompletableFuture<Long> take(
      MatchStore.PlayerRow row, UUID key, AccountId.Player account, long amount) {
    if (amount == 0) {
      return CompletableFuture.completedFuture(0L);
    }
    var request =
        new KeyedTransfer(
            key,
            account,
            new AccountId.Server(),
            Money.of(row.currency(), amount),
            reason(row.matchId(), row.outcome()));
    return wallets
        .transferOnce(request)
        .thenCompose(
            result ->
                switch (result) {
                  case Result.Ok<Receipt, EconomyError>(var receipt) ->
                      CompletableFuture.completedFuture(-receipt.amount().amount());
                  // They spent some between the read and the charge: take what is left.
                  case Result.Err<Receipt, EconomyError>(
                          EconomyError.InsufficientFunds(var _, var balance, var _)) ->
                      take(row, key, account, Math.min(amount, balance.amount()));
                  case Result.Err<Receipt, EconomyError>(var error) ->
                      throw new IllegalStateException("an AFK charge was refused: " + error);
                });
  }
}
