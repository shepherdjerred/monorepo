package com.shepherdjerred.thestorm.rwf.app;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.economy.app.AccountId;
import com.shepherdjerred.thestorm.economy.app.Crystals;
import com.shepherdjerred.thestorm.economy.app.EconomyError;
import com.shepherdjerred.thestorm.economy.app.KeyedTransfer;
import com.shepherdjerred.thestorm.economy.app.Receipt;
import com.shepherdjerred.thestorm.economy.app.Wallets;
import com.shepherdjerred.thestorm.rwf.app.store.MatchStore;
import java.nio.charset.StandardCharsets;
import java.time.InstantSource;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/**
 * Pays match rewards through the economy's keyed transfers. Every payout is first a row in the
 * {@link MatchStore} outbox; it is paid with the idempotency key {@code rwf:<matchId>:<player>}, so
 * a replay after a crash returns the original receipt instead of paying twice. Credits above the
 * day's cap are forfeited, which the store records as the difference between what was owed and what
 * was paid. Bots never reach this class: the rules award them nothing.
 */
public final class PayoutService {

  /**
   * The payout settings.
   *
   * @param dailyCap the most credits one player earns from matches in one day
   * @param zone the time zone whose midnight starts a new day
   */
  public record Settings(long dailyCap, ZoneId zone) {

    public Settings {
      if (dailyCap < 1) {
        throw new IllegalArgumentException("dailyCap must be positive: " + dailyCap);
      }
    }
  }

  /**
   * One payout that went through the ledger.
   *
   * @param matchId the match
   * @param player who
   * @param owed what the rules awarded
   * @param paid what reached their wallet after the daily cap
   */
  public record Paid(UUID matchId, UUID player, long owed, long paid) {}

  private final Wallets wallets;
  private final MatchStore store;
  private final Settings settings;
  private final InstantSource time;

  public PayoutService(Wallets wallets, MatchStore store, Settings settings, InstantSource time) {
    this.wallets = wallets;
    this.store = store;
    this.settings = settings;
    this.time = time;
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
    var day = LocalDate.ofInstant(time.instant(), settings.zone());
    return store
        .beginPayout(row.matchId(), row.player(), day, settings.dailyCap())
        .thenCompose(amount -> transfer(row, amount))
        .thenCompose(
            amount ->
                store
                    .finishPayout(row.matchId(), row.player())
                    .thenApply(
                        ignored ->
                            new Paid(row.matchId(), row.player(), row.creditsOwed(), amount)));
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
            Crystals.of(amount),
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
}
