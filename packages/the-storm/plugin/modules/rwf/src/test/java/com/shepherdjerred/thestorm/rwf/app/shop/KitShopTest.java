package com.shepherdjerred.thestorm.rwf.app.shop;

import static com.shepherdjerred.thestorm.rwf.testing.Samples.T0;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.economy.app.AccountId;
import com.shepherdjerred.thestorm.economy.app.CurrencyId;
import com.shepherdjerred.thestorm.economy.app.KeyedTransfer;
import com.shepherdjerred.thestorm.economy.app.Money;
import com.shepherdjerred.thestorm.rwf.adapter.db.JooqKitStore;
import com.shepherdjerred.thestorm.rwf.domain.kit.KitBook;
import com.shepherdjerred.thestorm.rwf.testing.FakeWallets;
import com.shepherdjerred.thestorm.rwf.testing.Samples;
import java.nio.file.Path;
import java.util.ArrayDeque;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletionException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * Buying kits against a real SQLite outbox and the fake ledger: a purchase charges once and grants
 * once, a refused one charges nothing, and a crash at any point between the two is settled by the
 * ledger's own record on the next start.
 */
final class KitShopTest {

  private static final UUID ALICE = Samples.ALICE.uuid();
  private static final AccountId.Player WALLET = new AccountId.Player(ALICE);

  @TempDir Path directory;
  private StormDatabase database;
  private FakeWallets wallets;
  private JooqKitStore store;
  private final ArrayDeque<UUID> ids = new ArrayDeque<>();

  @BeforeEach
  void open() {
    database = StormDatabase.open(directory.resolve("t.db"));
    database.migrate("rwf", getClass().getClassLoader());
    wallets = new FakeWallets();
    store = new JooqKitStore(database);
  }

  @AfterEach
  void close() {
    database.close();
  }

  private KitShop shop() {
    return new KitShop(wallets, store, () -> nextId());
  }

  private UUID nextId() {
    var id = ids.poll();
    return id == null ? UUID.randomUUID() : id;
  }

  private void fund(long credits) {
    wallets.hold(WALLET, Money.of(CurrencyId.RWF_CREDITS, credits));
  }

  private long held() {
    return wallets.held(WALLET, CurrencyId.RWF_CREDITS).amount();
  }

  @Test
  void aPurchaseTakesThePriceInCreditsOnceAndOwnsTheKit() {
    fund(450);

    var bought = shop().buy(ALICE, KitBook.BERSERKER, T0).join();

    assertThat(bought).isInstanceOf(Result.Ok.class);
    assertThat(held()).isEqualTo(50);
    assertThat(store.owned(ALICE).join()).containsExactly("berserker");
    assertThat(store.pending().join()).isEmpty();
    var receipt = wallets.receipts().getLast();
    assertThat(receipt.reason()).isEqualTo("rwf:kit:berserker");
    assertThat(receipt.amount()).isEqualTo(Money.of(CurrencyId.RWF_CREDITS, 400));
    assertThat(receipt.to()).isEqualTo(new AccountId.Server());
  }

  @Test
  void anOwnedKitIsNeverChargedAgain() {
    fund(1000);
    shop().buy(ALICE, KitBook.BERSERKER, T0).join();

    var again = shop().buy(ALICE, KitBook.BERSERKER, T0).join();

    assertThat(again).isEqualTo(Result.err(new ShopError.AlreadyOwned("berserker")));
    assertThat(held()).isEqualTo(600);
  }

  @Test
  void tooFewCreditsBuysNothingAndLeavesNothingPending() {
    fund(399);

    var refused = shop().buy(ALICE, KitBook.BERSERKER, T0).join();

    assertThat(refused).isEqualTo(Result.err(new ShopError.TooPoor(400, 399)));
    assertThat(held()).isEqualTo(399);
    assertThat(store.owned(ALICE).join()).isEmpty();
    assertThat(store.pending().join()).isEmpty();
    fund(400);
    assertThat(shop().buy(ALICE, KitBook.BERSERKER, T0).join()).isInstanceOf(Result.Ok.class);
  }

  @Test
  void freeKitsAreNotForSale() {
    assertThat(shop().buy(ALICE, KitBook.MEDIC, T0).join())
        .isEqualTo(Result.err(new ShopError.NotForSale("medic")));
    assertThat(wallets.receipts()).isEmpty();
  }

  @Test
  void aSecondPurchaseOfTheSameKitWhileOneIsPendingIsRefused() {
    var first = new Purchase(UUID.randomUUID(), ALICE, "berserker", 400, T0);
    assertThat(store.begin(first).join()).isTrue();
    fund(1000);

    var second = shop().buy(ALICE, KitBook.BERSERKER, T0).join();

    assertThat(second).isEqualTo(Result.err(new ShopError.InProgress("berserker")));
    assertThat(held()).isEqualTo(1000);
  }

  @Test
  void retryAfterAFailedGrantFinishesTheChargedPurchaseWithoutAnotherDebit() {
    fund(800);
    var buying = shop();
    database
        .write(
            dsl ->
                dsl.execute(
                    "CREATE TRIGGER reject_kit_grant BEFORE INSERT ON rwf_kit_owned "
                        + "BEGIN SELECT RAISE(ABORT, 'grant unavailable'); END"))
        .join();

    assertThatThrownBy(() -> buying.buy(ALICE, KitBook.BERSERKER, T0).join())
        .isInstanceOf(CompletionException.class)
        .hasMessageContaining("grant unavailable");
    var pending = store.pending().join();
    assertThat(pending).hasSize(1);
    assertThat(store.owned(ALICE).join()).isEmpty();
    assertThat(held()).isEqualTo(400);
    database.write(dsl -> dsl.execute("DROP TRIGGER reject_kit_grant")).join();

    assertThat(buying.buy(ALICE, KitBook.BERSERKER, T0.plusSeconds(1)).join())
        .isEqualTo(Result.ok(pending.getFirst()));
    assertThat(store.owned(ALICE).join()).containsExactly("berserker");
    assertThat(store.pending().join()).isEmpty();
    assertThat(held()).as("the retry grants the original debit").isEqualTo(400);
    assertThat(wallets.receipts()).hasSize(1);
  }

  @Test
  void aCrashAfterTheChargeGrantsTheKitOnTheNextStart() {
    // The purchase was opened and the ledger took the credits, then the server died before the
    // grant was written.
    var purchase = new Purchase(UUID.randomUUID(), ALICE, "venom", 400, T0);
    store.begin(purchase).join();
    fund(400);
    wallets
        .transferOnce(
            new KeyedTransfer(
                purchase.id(),
                WALLET,
                new AccountId.Server(),
                Money.of(CurrencyId.RWF_CREDITS, 400),
                purchase.reason()))
        .join();

    var settled = shop().replay(T0.plusSeconds(60)).join();

    assertThat(settled).containsExactly(new KitShop.Settled(purchase, true));
    assertThat(store.owned(ALICE).join()).containsExactly("venom");
    assertThat(held()).as("charged exactly once").isZero();
    assertThat(store.pending().join()).isEmpty();
  }

  @Test
  void aCrashBeforeTheChargeCancelsThePurchaseOnTheNextStart() {
    var purchase = new Purchase(UUID.randomUUID(), ALICE, "venom", 400, T0);
    store.begin(purchase).join();
    fund(400);

    var settled = shop().replay(T0.plusSeconds(60)).join();

    assertThat(settled).containsExactly(new KitShop.Settled(purchase, false));
    assertThat(store.owned(ALICE).join()).isEmpty();
    assertThat(held()).as("nothing was taken").isEqualTo(400);
    assertThat(store.pending().join()).isEmpty();
    // The player can buy it afresh.
    assertThat(shop().buy(ALICE, KitBook.VENOM, T0.plusSeconds(61)).join())
        .isInstanceOf(Result.Ok.class);
  }

  @Test
  void aSettledPurchaseCannotChangeSides() {
    var purchase = new Purchase(UUID.randomUUID(), ALICE, "venom", 400, T0);
    store.begin(purchase).join();
    store.grant(purchase.id(), T0).join();
    store.grant(purchase.id(), T0).join();

    assertThatThrownBy(() -> store.cancel(purchase.id(), T0).join())
        .isInstanceOf(CompletionException.class)
        .hasMessageContaining("granted");
    assertThat(store.owned(ALICE).join()).containsExactly("venom");
  }

  @Test
  void replayingWithNothingPendingSettlesNothing() {
    assertThat(shop().replay(T0).join()).isEqualTo(List.of());
  }
}
