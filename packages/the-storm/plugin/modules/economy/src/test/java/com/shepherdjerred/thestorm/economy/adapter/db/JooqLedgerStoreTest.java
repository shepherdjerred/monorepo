package com.shepherdjerred.thestorm.economy.adapter.db;

import static com.shepherdjerred.thestorm.economy.adapter.db.generated.Tables.ECONOMY_ACCOUNT;
import static com.shepherdjerred.thestorm.economy.adapter.db.generated.Tables.ECONOMY_LEDGER;
import static com.shepherdjerred.thestorm.economy.app.CurrencyId.CRYSTALS;
import static com.shepherdjerred.thestorm.economy.app.CurrencyId.RWF_CREDITS;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.economy.app.AccountId;
import com.shepherdjerred.thestorm.economy.app.CurrencyId;
import com.shepherdjerred.thestorm.economy.app.EconomyError;
import com.shepherdjerred.thestorm.economy.app.KeyedTransfer;
import com.shepherdjerred.thestorm.economy.app.Money;
import com.shepherdjerred.thestorm.economy.app.RankedPlayer;
import com.shepherdjerred.thestorm.economy.app.Receipt;
import com.shepherdjerred.thestorm.economy.app.SeenPlayer;
import com.shepherdjerred.thestorm.economy.domain.TransferRules;
import java.nio.file.Path;
import java.time.Instant;
import java.time.InstantSource;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.SplittableRandom;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.stream.IntStream;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

final class JooqLedgerStoreTest {

  private static final Instant NOW = Instant.parse("2026-09-24T12:00:00.123Z");
  private static final AccountId SERVER = new AccountId.Server();
  private static final AccountId.Player ALICE = new AccountId.Player(new UUID(0, 1));
  private static final AccountId.Player BOB = new AccountId.Player(new UUID(0, 2));
  private static final AccountId.Town TOWN = new AccountId.Town(new UUID(1, 1));

  @TempDir Path directory;

  private StormDatabase database;
  private JooqLedgerStore store;

  @BeforeEach
  void open() {
    database = StormDatabase.open(directory.resolve("t.db"));
    database.migrate("economy", JooqLedgerStoreTest.class.getClassLoader());
    store = new JooqLedgerStore(database, InstantSource.fixed(NOW), TransferRules.standard());
  }

  @AfterEach
  void close() {
    database.close();
  }

  private static <T> T await(CompletableFuture<T> future) throws Exception {
    return future.get(30, TimeUnit.SECONDS);
  }

  private Receipt fund(AccountId account, long amount) throws Exception {
    return switch (await(store.transfer(SERVER, account, Money.crystals(amount), "test-fund"))) {
      case Result.Ok<Receipt, EconomyError>(var receipt) -> receipt;
      case Result.Err<Receipt, EconomyError>(var error) -> throw new AssertionError(error);
    };
  }

  private long ledgerRows() throws Exception {
    return await(database.read(dsl -> dsl.fetchCount(ECONOMY_LEDGER)));
  }

  @Test
  void anUnknownAccountHasZero() throws Exception {
    assertThat(await(store.balance(ALICE, CRYSTALS))).isEqualTo(Money.crystals(0));
    assertThat(await(store.balance(TOWN, CRYSTALS))).isEqualTo(Money.crystals(0));
    assertThat(await(store.balance(SERVER, CRYSTALS))).isEqualTo(Money.crystals(0));
  }

  @Test
  void aTransferMovesCrystalsAndReturnsItsLedgerEntry() throws Exception {
    fund(ALICE, 100);

    var result = await(store.transfer(ALICE, BOB, Money.crystals(30), "pay"));

    assertThat(result).isInstanceOf(Result.Ok.class);
    var receipt = ((Result.Ok<Receipt, EconomyError>) result).value();
    assertThat(receipt.from()).isEqualTo(ALICE);
    assertThat(receipt.to()).isEqualTo(BOB);
    assertThat(receipt.amount()).isEqualTo(Money.crystals(30));
    assertThat(receipt.reason()).isEqualTo("pay");
    assertThat(receipt.at()).isEqualTo(NOW);
    assertThat(receipt.transactionId()).isEqualTo(2);
    assertThat(await(store.balance(ALICE, CRYSTALS))).isEqualTo(Money.crystals(70));
    assertThat(await(store.balance(BOB, CRYSTALS))).isEqualTo(Money.crystals(30));
  }

  @Test
  void theServerIsUnlimitedAndNeverStored() throws Exception {
    fund(ALICE, Long.MAX_VALUE / 4);
    fund(BOB, Long.MAX_VALUE / 4);

    var serverRows =
        await(
            database.read(
                dsl ->
                    dsl.fetchCount(ECONOMY_ACCOUNT, ECONOMY_ACCOUNT.KIND.eq(AccountKey.SERVER))));
    assertThat(serverRows).isZero();
    assertThat(await(store.balance(SERVER, CRYSTALS))).isEqualTo(Money.crystals(0));
  }

  @Test
  void aRefusedTransferChangesNothing() throws Exception {
    fund(ALICE, 10);
    var rowsBefore = ledgerRows();

    assertThat(await(store.transfer(ALICE, BOB, Money.crystals(11), "pay")))
        .isEqualTo(
            Result.err(
                new EconomyError.InsufficientFunds(ALICE, Money.crystals(10), Money.crystals(11))));
    assertThat(await(store.transfer(ALICE, ALICE, Money.crystals(1), "pay")))
        .isEqualTo(Result.err(new EconomyError.SameAccount(ALICE)));
    assertThat(await(store.transfer(ALICE, BOB, Money.crystals(0), "pay")))
        .isEqualTo(Result.err(new EconomyError.ZeroAmount(CRYSTALS)));

    assertThat(ledgerRows()).isEqualTo(rowsBefore);
    assertThat(await(store.balance(ALICE, CRYSTALS))).isEqualTo(Money.crystals(10));
    assertThat(await(store.balance(BOB, CRYSTALS))).isEqualTo(Money.crystals(0));
  }

  @Test
  void townsHoldAndSpendCrystals() throws Exception {
    fund(ALICE, 50);
    await(store.transfer(ALICE, TOWN, Money.crystals(50), "town-deposit"));
    await(store.transfer(TOWN, SERVER, Money.crystals(20), "upkeep"));

    assertThat(await(store.balance(ALICE, CRYSTALS))).isEqualTo(Money.crystals(0));
    assertThat(await(store.balance(TOWN, CRYSTALS))).isEqualTo(Money.crystals(30));
  }

  @Test
  void topListsPlayersWithCrystalsRichestFirstWithTheirNames() throws Exception {
    var carol = new AccountId.Player(new UUID(0, 3));
    await(
        store.welcome(
            new SeenPlayer(ALICE.uuid(), "Alice"), Money.crystals(0), "starting-balance"));
    await(store.welcome(new SeenPlayer(BOB.uuid(), "Bob"), Money.crystals(0), "starting-balance"));
    fund(ALICE, 300);
    fund(BOB, 900);
    fund(carol, 300);
    fund(TOWN, 10_000);
    fund(new AccountId.Player(new UUID(0, 4)), 1);
    await(store.transfer(new AccountId.Player(new UUID(0, 4)), SERVER, Money.crystals(1), "spent"));

    assertThat(await(store.top(CRYSTALS, 10)))
        .containsExactly(
            new RankedPlayer(BOB, Optional.of("Bob"), Money.crystals(900)),
            new RankedPlayer(ALICE, Optional.of("Alice"), Money.crystals(300)),
            new RankedPlayer(carol, Optional.empty(), Money.crystals(300)));
    assertThat(await(store.top(CRYSTALS, 1)))
        .containsExactly(new RankedPlayer(BOB, Optional.of("Bob"), Money.crystals(900)));
  }

  @Test
  void eachCurrencyHasItsOwnBalanceLedgerAndLeaderboard() throws Exception {
    fund(ALICE, 100);
    await(store.transfer(SERVER, BOB, Money.rwfCredits(3), "rwf:win"));
    await(store.transfer(SERVER, ALICE, Money.rwfCredits(1), "rwf:lose"));

    assertThat(await(store.balance(ALICE, CRYSTALS))).isEqualTo(Money.crystals(100));
    assertThat(await(store.balance(ALICE, RWF_CREDITS))).isEqualTo(Money.rwfCredits(1));
    assertThat(await(store.balance(BOB, CRYSTALS))).isEqualTo(Money.crystals(0));
    assertThat(await(store.balances(BOB)))
        .containsExactly(
            Map.entry(CRYSTALS, Money.crystals(0)), Map.entry(RWF_CREDITS, Money.rwfCredits(3)));
    assertThat(await(store.top(CRYSTALS, 10)))
        .containsExactly(new RankedPlayer(ALICE, Optional.empty(), Money.crystals(100)));
    assertThat(await(store.top(RWF_CREDITS, 10)))
        .containsExactly(
            new RankedPlayer(BOB, Optional.empty(), Money.rwfCredits(3)),
            new RankedPlayer(ALICE, Optional.empty(), Money.rwfCredits(1)));
    var currencies =
        await(
            database.read(
                dsl ->
                    dsl.select(ECONOMY_LEDGER.CURRENCY)
                        .from(ECONOMY_LEDGER)
                        .orderBy(ECONOMY_LEDGER.ID)
                        .fetch(ECONOMY_LEDGER.CURRENCY)));
    assertThat(currencies).containsExactly("crystals", "rwf_credits", "rwf_credits");
  }

  @Test
  void oneCurrencyNeverPaysForAnother() throws Exception {
    fund(ALICE, 100);

    assertThat(await(store.transfer(ALICE, BOB, Money.rwfCredits(1), "pay")))
        .isEqualTo(
            Result.err(
                new EconomyError.InsufficientFunds(
                    ALICE, Money.rwfCredits(0), Money.rwfCredits(1))));
    assertThat(await(store.balance(ALICE, CRYSTALS))).isEqualTo(Money.crystals(100));
  }

  @Test
  void setBalanceOnlyTouchesItsCurrency() throws Exception {
    fund(ALICE, 100);

    var set = await(store.setBalance(ALICE, Money.rwfCredits(7), "eco-set by Admin"));

    assertThat(set.orElseThrow().amount()).isEqualTo(Money.rwfCredits(7));
    assertThat(await(store.balance(ALICE, RWF_CREDITS))).isEqualTo(Money.rwfCredits(7));
    assertThat(await(store.balance(ALICE, CRYSTALS))).isEqualTo(Money.crystals(100));
  }

  @Test
  void aKeyedTransferPaysOnceAndReplaysItsReceipt() throws Exception {
    var key = UUID.randomUUID();
    var request = new KeyedTransfer(key, SERVER, ALICE, Money.rwfCredits(3), "rwf:match:WIN");

    var first = await(store.transferOnce(request));
    var again = await(store.transferOnce(request));

    assertThat(first).isEqualTo(again);
    assertThat(await(store.receiptFor(key)))
        .contains(((Result.Ok<Receipt, EconomyError>) first).value());
    assertThat(await(store.balance(ALICE, RWF_CREDITS))).isEqualTo(Money.rwfCredits(3));
    assertThat(await(store.balance(ALICE, CRYSTALS))).isEqualTo(Money.crystals(0));
    assertThat(ledgerRows()).isEqualTo(1);
  }

  @Test
  void reusingAKeyForAnotherCurrencyIsAContractError() throws Exception {
    var key = UUID.randomUUID();
    await(store.transferOnce(new KeyedTransfer(key, SERVER, ALICE, Money.crystals(3), "r")));

    assertThatThrownBy(
            () ->
                await(
                    store.transferOnce(
                        new KeyedTransfer(key, SERVER, ALICE, Money.rwfCredits(3), "r"))))
        .isInstanceOf(ExecutionException.class)
        .hasMessageContaining("transfer key reused");
    assertThat(await(store.balance(ALICE, RWF_CREDITS))).isEqualTo(Money.rwfCredits(0));
    assertThat(ledgerRows()).isEqualTo(1);
  }

  @Test
  void findPlayerMatchesTheLastNameIgnoringCase() throws Exception {
    await(store.welcome(new SeenPlayer(ALICE.uuid(), "Alice"), Money.crystals(500), "starting"));

    assertThat(await(store.findPlayer("alice"))).contains(new SeenPlayer(ALICE.uuid(), "Alice"));
    assertThat(await(store.findPlayer("ALICE"))).contains(new SeenPlayer(ALICE.uuid(), "Alice"));
    assertThat(await(store.findPlayer("Alic"))).isEmpty();
    assertThat(await(store.findPlayer("Nobody"))).isEmpty();
  }

  @Test
  void rejoiningUnderANewNameUpdatesItWithoutPayingAgain() throws Exception {
    await(store.welcome(new SeenPlayer(ALICE.uuid(), "Alice"), Money.crystals(500), "starting"));
    var renamed =
        await(
            store.welcome(new SeenPlayer(ALICE.uuid(), "Alicia"), Money.crystals(500), "starting"));

    assertThat(renamed).isEmpty();
    assertThat(await(store.findPlayer("Alicia"))).contains(new SeenPlayer(ALICE.uuid(), "Alicia"));
    assertThat(await(store.findPlayer("Alice"))).isEmpty();
    assertThat(await(store.balance(ALICE, CRYSTALS))).isEqualTo(Money.crystals(500));
  }

  @Test
  void aReusedNameFindsWhoeverJoinedWithItMostRecently() throws Exception {
    var early = new JooqLedgerStore(database, InstantSource.fixed(NOW), TransferRules.standard());
    var later =
        new JooqLedgerStore(
            database, InstantSource.fixed(NOW.plusSeconds(60)), TransferRules.standard());
    await(early.welcome(new SeenPlayer(ALICE.uuid(), "Storm"), Money.crystals(0), "starting"));
    await(later.welcome(new SeenPlayer(BOB.uuid(), "storm"), Money.crystals(0), "starting"));

    assertThat(await(store.findPlayer("STORM"))).contains(new SeenPlayer(BOB.uuid(), "storm"));
  }

  @Test
  void aFailureMidTransferRollsTheWholeTransferBack() throws Exception {
    fund(ALICE, 100);
    await(
        database.write(
            dsl ->
                dsl.execute(
                    "CREATE TRIGGER fail_ledger BEFORE INSERT ON economy_ledger"
                        + " BEGIN SELECT RAISE(ABORT, 'ledger unavailable'); END")));
    var rowsBefore = ledgerRows();

    assertThatThrownBy(() -> await(store.transfer(ALICE, BOB, Money.crystals(40), "pay")))
        .isInstanceOf(ExecutionException.class)
        .hasMessageContaining("ledger unavailable");

    assertThat(await(store.balance(ALICE, CRYSTALS))).isEqualTo(Money.crystals(100));
    assertThat(await(store.balance(BOB, CRYSTALS))).isEqualTo(Money.crystals(0));
    assertThat(ledgerRows()).isEqualTo(rowsBefore);
    var bobRows =
        await(
            database.read(
                dsl ->
                    dsl.fetchCount(ECONOMY_ACCOUNT, ECONOMY_ACCOUNT.ID.eq(BOB.uuid().toString()))));
    assertThat(bobRows).isZero();
  }

  @Test
  void welcomeGrantsTheStartingBalanceOnce() throws Exception {
    var first =
        await(
            store.welcome(
                new SeenPlayer(ALICE.uuid(), "Alice"), Money.crystals(500), "starting-balance"));
    var second =
        await(
            store.welcome(
                new SeenPlayer(ALICE.uuid(), "Alice"), Money.crystals(500), "starting-balance"));

    assertThat(first).isPresent();
    assertThat(first.orElseThrow().from()).isEqualTo(SERVER);
    assertThat(first.orElseThrow().reason()).isEqualTo("starting-balance");
    assertThat(second).isEmpty();
    assertThat(await(store.balance(ALICE, CRYSTALS))).isEqualTo(Money.crystals(500));
    assertThat(ledgerRows()).isEqualTo(1);
  }

  @Test
  void welcomesSubmittedTogetherAreSerializedByTheWriterAndPayOnce() throws Exception {
    var futures =
        IntStream.range(0, 50)
            .mapToObj(
                i ->
                    store.welcome(
                        new SeenPlayer(BOB.uuid(), "Bob"), Money.crystals(500), "starting-balance"))
            .toList();
    CompletableFuture.allOf(futures.toArray(CompletableFuture[]::new)).get(30, TimeUnit.SECONDS);

    var grants = futures.stream().map(CompletableFuture::join).filter(Optional::isPresent).count();
    assertThat(grants).isEqualTo(1);
    assertThat(await(store.balance(BOB, CRYSTALS))).isEqualTo(Money.crystals(500));
  }

  @Test
  void welcomeSurvivesReopeningTheDatabase() throws Exception {
    await(
        store.welcome(
            new SeenPlayer(ALICE.uuid(), "Alice"), Money.crystals(500), "starting-balance"));
    database.close();
    database = StormDatabase.open(directory.resolve("t.db"));
    database.migrate("economy", JooqLedgerStoreTest.class.getClassLoader());
    store = new JooqLedgerStore(database, InstantSource.fixed(NOW), TransferRules.standard());

    assertThat(
            await(
                store.welcome(
                    new SeenPlayer(ALICE.uuid(), "Alice"),
                    Money.crystals(500),
                    "starting-balance")))
        .isEmpty();
    assertThat(await(store.balance(ALICE, CRYSTALS))).isEqualTo(Money.crystals(500));
  }

  @Test
  void aZeroStartingBalanceMarksThePlayerWithoutALedgerEntry() throws Exception {
    assertThat(
            await(
                store.welcome(
                    new SeenPlayer(ALICE.uuid(), "Alice"), Money.crystals(0), "starting-balance")))
        .isEmpty();
    assertThat(ledgerRows()).isZero();
  }

  @Test
  void setBalanceRaisesLowersAndKeeps() throws Exception {
    var raised = await(store.setBalance(ALICE, Money.crystals(250), "eco-set by Admin"));
    assertThat(raised.orElseThrow().from()).isEqualTo(SERVER);
    assertThat(raised.orElseThrow().amount()).isEqualTo(Money.crystals(250));

    var lowered = await(store.setBalance(ALICE, Money.crystals(100), "eco-set by Admin"));
    assertThat(lowered.orElseThrow().to()).isEqualTo(SERVER);
    assertThat(lowered.orElseThrow().amount()).isEqualTo(Money.crystals(150));

    assertThat(await(store.setBalance(ALICE, Money.crystals(100), "eco-set by Admin"))).isEmpty();
    assertThat(await(store.balance(ALICE, CRYSTALS))).isEqualTo(Money.crystals(100));
    assertThat(ledgerRows()).isEqualTo(2);
  }

  @Test
  void theServerHasNoBalanceToSet() {
    assertThatThrownBy(() -> store.setBalance(SERVER, Money.crystals(0), "eco-set by Admin"))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void transfersSubmittedTogetherAreSerializedByTheWriterNeverOverdrawAndMatchTheLedger()
      throws Exception {
    var players =
        IntStream.range(0, 8).mapToObj(i -> new AccountId.Player(new UUID(2, i))).toList();
    List<AccountId> accounts = new ArrayList<>(players);
    accounts.add(TOWN);
    for (var account : accounts) {
      fund(account, 100);
      await(store.transfer(SERVER, account, Money.rwfCredits(100), "test-fund"));
    }
    accounts.add(SERVER);

    var random = new SplittableRandom(26);
    var currencies = CurrencyId.values();
    var futures = new ArrayList<CompletableFuture<Result<Receipt, EconomyError>>>();
    for (var i = 0; i < 1_000; i++) {
      var from = accounts.get(random.nextInt(accounts.size()));
      var to = accounts.get(random.nextInt(accounts.size()));
      var amount = Money.of(currencies[random.nextInt(currencies.length)], random.nextInt(0, 80));
      futures.add(store.transfer(from, to, amount, "stress"));
    }
    CompletableFuture.allOf(futures.toArray(CompletableFuture[]::new)).get(60, TimeUnit.SECONDS);

    var succeeded = futures.stream().map(CompletableFuture::join).filter(Result::isOk).count();
    var refused = futures.size() - succeeded;
    assertThat(succeeded).isPositive();
    assertThat(refused).isPositive();
    assertThat(ledgerRows()).isEqualTo(2L * (accounts.size() - 1) + succeeded);

    var replayed = replayLedger();
    for (var account : accounts.subList(0, accounts.size() - 1)) {
      for (var currency : currencies) {
        var key = AccountKey.of(account);
        var stored = await(store.balance(account, currency)).amount();
        assertThat(stored).isNotNegative();
        assertThat(replayed.getOrDefault(Map.entry(key, currency.key()), 0L))
            .as("%s ledger for %s", currency.key(), key)
            .isEqualTo(stored);
      }
    }
  }

  /** Every account's net flow in each currency according to the ledger alone. */
  private Map<Map.Entry<AccountKey, String>, Long> replayLedger() throws Exception {
    var rows =
        await(
            database.read(
                dsl ->
                    dsl.select(
                            ECONOMY_LEDGER.FROM_KIND,
                            ECONOMY_LEDGER.FROM_ID,
                            ECONOMY_LEDGER.TO_KIND,
                            ECONOMY_LEDGER.TO_ID,
                            ECONOMY_LEDGER.AMOUNT,
                            ECONOMY_LEDGER.CURRENCY)
                        .from(ECONOMY_LEDGER)
                        .fetch()));
    var net = new HashMap<Map.Entry<AccountKey, String>, Long>();
    for (var row : rows) {
      var from = Map.entry(new AccountKey(row.value1(), row.value2()), row.value6());
      var to = Map.entry(new AccountKey(row.value3(), row.value4()), row.value6());
      net.merge(from, -row.value5(), Long::sum);
      net.merge(to, row.value5(), Long::sum);
    }
    return net;
  }
}
