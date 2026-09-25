package com.shepherdjerred.thestorm.economy.adapter.db;

import static com.shepherdjerred.thestorm.economy.adapter.db.generated.Tables.ECONOMY_ACCOUNT;
import static com.shepherdjerred.thestorm.economy.adapter.db.generated.Tables.ECONOMY_LEDGER;
import static com.shepherdjerred.thestorm.economy.adapter.db.generated.Tables.ECONOMY_PLAYER_SEEN;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.economy.app.AccountId;
import com.shepherdjerred.thestorm.economy.app.Crystals;
import com.shepherdjerred.thestorm.economy.app.EconomyError;
import com.shepherdjerred.thestorm.economy.app.LedgerStore;
import com.shepherdjerred.thestorm.economy.app.RankedPlayer;
import com.shepherdjerred.thestorm.economy.app.Receipt;
import com.shepherdjerred.thestorm.economy.app.SeenPlayer;
import com.shepherdjerred.thestorm.economy.domain.Accounts;
import com.shepherdjerred.thestorm.economy.domain.Adjustments;
import com.shepherdjerred.thestorm.economy.domain.PendingTransfer;
import com.shepherdjerred.thestorm.economy.domain.Settlement;
import com.shepherdjerred.thestorm.economy.domain.Transfer;
import com.shepherdjerred.thestorm.economy.domain.TransferRules;
import java.time.Instant;
import java.time.InstantSource;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.jooq.DSLContext;

/**
 * The ledger in SQLite. Every write runs in one transaction on the database's single writer thread,
 * which reads the balances involved, applies {@link TransferRules}, stores the new balances and
 * appends the ledger entry, so no two transfers can interleave and overdraw an account.
 */
public final class JooqLedgerStore implements LedgerStore {

  private final StormDatabase database;
  private final InstantSource time;
  private final TransferRules rules;

  public JooqLedgerStore(StormDatabase database, InstantSource time, TransferRules rules) {
    this.database = database;
    this.time = time;
    this.rules = rules;
  }

  @Override
  public CompletableFuture<Crystals> balance(AccountId account) {
    return database.read(dsl -> storedBalance(dsl, account));
  }

  @Override
  public CompletableFuture<Result<Receipt, EconomyError>> transfer(
      AccountId from, AccountId to, Crystals amount, String reason) {
    return database.write(dsl -> apply(dsl, new Transfer(from, to, amount), reason));
  }

  @Override
  public CompletableFuture<List<RankedPlayer>> top(int limit) {
    return database.read(
        dsl ->
            dsl.select(ECONOMY_ACCOUNT.ID, ECONOMY_ACCOUNT.BALANCE, ECONOMY_PLAYER_SEEN.LAST_NAME)
                .from(ECONOMY_ACCOUNT)
                .leftJoin(ECONOMY_PLAYER_SEEN)
                .on(ECONOMY_PLAYER_SEEN.PLAYER_ID.eq(ECONOMY_ACCOUNT.ID))
                .where(ECONOMY_ACCOUNT.KIND.eq(AccountKey.PLAYER), ECONOMY_ACCOUNT.BALANCE.gt(0L))
                .orderBy(ECONOMY_ACCOUNT.BALANCE.desc(), ECONOMY_ACCOUNT.ID.asc())
                .limit(limit)
                .fetch(
                    row ->
                        new RankedPlayer(
                            new AccountId.Player(UUID.fromString(row.value1())),
                            Optional.ofNullable(row.value3()),
                            new Crystals(row.value2()))));
  }

  @Override
  public CompletableFuture<Optional<Receipt>> welcome(
      SeenPlayer player, Crystals grant, String reason) {
    return database.write(
        dsl -> {
          var firstJoin = remember(dsl, player);
          if (!firstJoin || grant.equals(Crystals.ZERO)) {
            return Optional.empty();
          }
          var transfer = new Transfer(new AccountId.Server(), player.account(), grant);
          return Optional.of(applyOrFail(dsl, transfer, reason));
        });
  }

  @Override
  public CompletableFuture<Optional<SeenPlayer>> findPlayer(String name) {
    return database.read(
        dsl ->
            dsl.select(ECONOMY_PLAYER_SEEN.PLAYER_ID, ECONOMY_PLAYER_SEEN.LAST_NAME)
                .from(ECONOMY_PLAYER_SEEN)
                .where(ECONOMY_PLAYER_SEEN.LAST_NAME.collate("NOCASE").eq(name))
                .orderBy(ECONOMY_PLAYER_SEEN.UPDATED_AT.desc())
                .limit(1)
                .fetchOptional(row -> new SeenPlayer(UUID.fromString(row.value1()), row.value2())));
  }

  /** Stores {@code player}'s current name; true when this is the first time they are seen. */
  private boolean remember(DSLContext dsl, SeenPlayer player) {
    var id = player.uuid().toString();
    var now = time.millis();
    if (dsl.fetchExists(ECONOMY_PLAYER_SEEN, ECONOMY_PLAYER_SEEN.PLAYER_ID.eq(id))) {
      dsl.update(ECONOMY_PLAYER_SEEN)
          .set(ECONOMY_PLAYER_SEEN.LAST_NAME, player.name())
          .set(ECONOMY_PLAYER_SEEN.UPDATED_AT, now)
          .where(ECONOMY_PLAYER_SEEN.PLAYER_ID.eq(id))
          .execute();
      return false;
    }
    dsl.insertInto(ECONOMY_PLAYER_SEEN)
        .set(ECONOMY_PLAYER_SEEN.PLAYER_ID, id)
        .set(ECONOMY_PLAYER_SEEN.FIRST_SEEN, now)
        .set(ECONOMY_PLAYER_SEEN.LAST_NAME, player.name())
        .set(ECONOMY_PLAYER_SEEN.UPDATED_AT, now)
        .execute();
    return true;
  }

  @Override
  public CompletableFuture<Optional<Receipt>> setBalance(
      AccountId account, Crystals target, String reason) {
    if (!Accounts.hasBalance(account)) {
      throw new IllegalArgumentException("the server account has no balance to set");
    }
    return database.write(
        dsl ->
            Adjustments.toReach(account, storedBalance(dsl, account), target)
                .map(transfer -> applyOrFail(dsl, transfer, reason)));
  }

  /** A transfer the domain built to be valid; a refusal here is a broken invariant. */
  private Receipt applyOrFail(DSLContext dsl, Transfer transfer, String reason) {
    return switch (apply(dsl, transfer, reason)) {
      case Result.Ok<Receipt, EconomyError>(var receipt) -> receipt;
      case Result.Err<Receipt, EconomyError>(var error) ->
          throw new IllegalStateException("a constructed transfer was refused: " + error);
    };
  }

  private Result<Receipt, EconomyError> apply(DSLContext dsl, Transfer transfer, String reason) {
    var pending =
        new PendingTransfer(
            transfer, storedBalance(dsl, transfer.from()), storedBalance(dsl, transfer.to()));
    return rules.settle(pending).map(settlement -> record(dsl, settlement, reason));
  }

  private Receipt record(DSLContext dsl, Settlement settlement, String reason) {
    for (var update : settlement.updates()) {
      var key = AccountKey.of(update.account());
      dsl.insertInto(ECONOMY_ACCOUNT)
          .set(ECONOMY_ACCOUNT.KIND, key.kind())
          .set(ECONOMY_ACCOUNT.ID, key.id())
          .set(ECONOMY_ACCOUNT.BALANCE, update.balance().amount())
          .onConflict(ECONOMY_ACCOUNT.KIND, ECONOMY_ACCOUNT.ID)
          .doUpdate()
          .set(ECONOMY_ACCOUNT.BALANCE, update.balance().amount())
          .execute();
    }
    var transfer = settlement.transfer();
    var from = AccountKey.of(transfer.from());
    var to = AccountKey.of(transfer.to());
    var at = Instant.ofEpochMilli(time.millis());
    var id =
        dsl.insertInto(ECONOMY_LEDGER)
            .set(ECONOMY_LEDGER.FROM_KIND, from.kind())
            .set(ECONOMY_LEDGER.FROM_ID, from.id())
            .set(ECONOMY_LEDGER.TO_KIND, to.kind())
            .set(ECONOMY_LEDGER.TO_ID, to.id())
            .set(ECONOMY_LEDGER.AMOUNT, transfer.amount().amount())
            .set(ECONOMY_LEDGER.REASON, reason)
            .set(ECONOMY_LEDGER.AT, at.toEpochMilli())
            .returning(ECONOMY_LEDGER.ID)
            .fetchSingle()
            .getId();
    return new Receipt(id, transfer.from(), transfer.to(), transfer.amount(), reason, at);
  }

  private static Crystals storedBalance(DSLContext dsl, AccountId account) {
    if (!Accounts.hasBalance(account)) {
      return Crystals.ZERO;
    }
    var key = AccountKey.of(account);
    return dsl.select(ECONOMY_ACCOUNT.BALANCE)
        .from(ECONOMY_ACCOUNT)
        .where(ECONOMY_ACCOUNT.KIND.eq(key.kind()), ECONOMY_ACCOUNT.ID.eq(key.id()))
        .fetchOptional(ECONOMY_ACCOUNT.BALANCE)
        .map(Crystals::new)
        .orElse(Crystals.ZERO);
  }
}
