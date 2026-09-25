package com.shepherdjerred.thestorm.shops.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.economy.app.AccountId;
import com.shepherdjerred.thestorm.economy.app.Crystals;
import com.shepherdjerred.thestorm.economy.app.EconomyError;
import com.shepherdjerred.thestorm.shops.domain.trade.Direction;
import com.shepherdjerred.thestorm.shops.domain.trade.TradeProblem;
import java.time.Instant;
import java.time.InstantSource;
import java.util.UUID;
import java.util.concurrent.ExecutionException;
import org.junit.jupiter.api.Test;
import org.slf4j.helpers.NOPLogger;

final class TradeEngineTest {

  private static final AccountId ALICE = new AccountId.Player(new UUID(0, 1));
  private static final AccountId OWNER = new AccountId.Player(new UUID(0, 2));
  private static final AccountId SERVER = new AccountId.Server();

  private final FakeWallets wallets = new FakeWallets();
  private final FakeStore store = new FakeStore();
  private final TradeEngine engine =
      new TradeEngine(
          wallets,
          Runnable::run,
          new RefundJournal(store, InstantSource.fixed(Instant.EPOCH), NOPLogger.NOP_LOGGER));

  private final FakeHoldings customer = new FakeHoldings(0, 64);
  private final FakeHoldings shop = new FakeHoldings(0, 64);

  private Deal deal(Direction direction, AccountId counterparty, Holdings shopItems) {
    return new Deal(
        direction,
        16,
        Crystals.of(50),
        new Deal.Party(ALICE, customer),
        new Deal.Party(counterparty, shopItems),
        "shop:1:" + direction.id());
  }

  private TradeOutcome run(Deal deal) throws Exception {
    return engine.execute(deal).get();
  }

  @Test
  void buyingMovesCrystalsToTheOwnerAndItemsToTheCustomer() throws Exception {
    wallets.set(ALICE, 100);
    shop.count = 20;

    var outcome = run(deal(Direction.BUY, OWNER, shop));

    assertThat(outcome).isInstanceOf(TradeOutcome.Completed.class);
    assertThat(wallets.balanceOf(ALICE)).isEqualTo(50);
    assertThat(wallets.balanceOf(OWNER)).isEqualTo(50);
    assertThat(customer.count).isEqualTo(16);
    assertThat(shop.count).isEqualTo(4);
  }

  @Test
  void buyingFromAnOutOfStockShopMovesNothing() throws Exception {
    wallets.set(ALICE, 100);
    shop.count = 15;

    var outcome = run(deal(Direction.BUY, OWNER, shop));

    assertThat(outcome).isEqualTo(new TradeOutcome.Refused(new TradeProblem.OutOfStock(15, 16)));
    assertThat(wallets.receipts()).isEmpty();
    assertThat(shop.count).isEqualTo(15);
  }

  @Test
  void buyingWithAFullInventoryMovesNothing() throws Exception {
    wallets.set(ALICE, 100);
    shop.count = 64;
    customer.capacity = 10;

    var outcome = run(deal(Direction.BUY, OWNER, shop));

    assertThat(outcome).isEqualTo(new TradeOutcome.Refused(new TradeProblem.NoRoom(10, 16)));
    assertThat(wallets.receipts()).isEmpty();
  }

  @Test
  void buyingWithoutEnoughCrystalsMovesNothing() throws Exception {
    wallets.set(ALICE, 49);
    shop.count = 64;

    var outcome = run(deal(Direction.BUY, OWNER, shop));

    assertThat(outcome)
        .isEqualTo(new TradeOutcome.Refused(new TradeProblem.CustomerCannotPay(49, 50)));
    assertThat(shop.count).isEqualTo(64);
    assertThat(customer.count).isZero();
  }

  @Test
  void stockThatVanishesWhilePayingIsRefunded() throws Exception {
    wallets.set(ALICE, 100);
    shop.count = 16;
    wallets.afterNextTransfer(() -> shop.count = 0);

    var outcome = run(deal(Direction.BUY, OWNER, shop));

    assertThat(outcome).isEqualTo(new TradeOutcome.Refunded(new TradeProblem.OutOfStock(0, 16)));
    assertThat(wallets.balanceOf(ALICE)).isEqualTo(100);
    assertThat(wallets.balanceOf(OWNER)).isZero();
    assertThat(customer.count).isZero();
    assertThat(wallets.receipts())
        .extracting(receipt -> receipt.reason())
        .containsExactly("shop:1:buy", "refund:shop:1:buy");
  }

  @Test
  void aRefundTheLedgerRefusesIsLoggedAndNoItemsMove() throws Exception {
    wallets.set(ALICE, 100);
    shop.count = 16;
    wallets.afterNextTransfer(
        () -> {
          shop.count = 0;
          wallets.set(OWNER, 0);
        });

    var outcome = run(deal(Direction.BUY, OWNER, shop));

    assertThat(outcome).isInstanceOf(TradeOutcome.RefundFailed.class);
    assertThat(((TradeOutcome.RefundFailed) outcome).problem())
        .isEqualTo(new TradeProblem.OutOfStock(0, 16));
    assertThat(customer.count).isZero();
    assertThat(store.refundFailures)
        .singleElement()
        .satisfies(
            failure -> {
              assertThat(failure.payer()).isEqualTo(OWNER);
              assertThat(failure.payee()).isEqualTo(ALICE);
              assertThat(failure.amount()).isEqualTo(Crystals.of(50));
              assertThat(failure.reason()).isEqualTo("refund:shop:1:buy");
            });
  }

  @Test
  void aRefundThatFailsOutrightIsLoggedToo() throws Exception {
    wallets.set(ALICE, 100);
    shop.count = 16;
    wallets.afterNextTransfer(
        () -> {
          shop.count = 0;
          wallets.failNext(new IllegalStateException("database down"));
        });

    var outcome = run(deal(Direction.BUY, OWNER, shop));

    assertThat(outcome).isInstanceOf(TradeOutcome.RefundFailed.class);
    assertThat(((TradeOutcome.RefundFailed) outcome).why()).contains("database down");
    assertThat(store.refundFailures).hasSize(1);
  }

  @Test
  void aFailedPaymentWhenBuyingFailsTheTradeAndMovesNothing() {
    wallets.set(ALICE, 100);
    shop.count = 16;
    wallets.failNext(new IllegalStateException("database down"));

    assertThatThrownBy(() -> run(deal(Direction.BUY, OWNER, shop)))
        .isInstanceOf(ExecutionException.class)
        .hasRootCauseMessage("database down");
    assertThat(shop.count).isEqualTo(16);
    assertThat(customer.count).isZero();
  }

  @Test
  void sellingMovesItemsToTheShopAndCrystalsToTheCustomer() throws Exception {
    wallets.set(OWNER, 100);
    customer.count = 20;

    var outcome = run(deal(Direction.SELL, OWNER, shop));

    assertThat(outcome).isInstanceOf(TradeOutcome.Completed.class);
    assertThat(customer.count).isEqualTo(4);
    assertThat(shop.count).isEqualTo(16);
    assertThat(wallets.balanceOf(ALICE)).isEqualTo(50);
    assertThat(wallets.balanceOf(OWNER)).isEqualTo(50);
  }

  @Test
  void theCustomersItemsAreHeldInEscrowWhileTheOwnerPays() throws Exception {
    wallets.set(OWNER, 100);
    customer.count = 16;
    var seenDuringPayment = new int[1];
    wallets.afterNextTransfer(() -> seenDuringPayment[0] = customer.count);

    run(deal(Direction.SELL, OWNER, shop));

    assertThat(seenDuringPayment[0]).isZero();
  }

  @Test
  void anOwnerWhoCannotPayGetsNoItems() throws Exception {
    wallets.set(OWNER, 10);
    customer.count = 16;

    var outcome = run(deal(Direction.SELL, OWNER, shop));

    assertThat(outcome).isEqualTo(new TradeOutcome.Refused(new TradeProblem.OwnerCannotPay()));
    assertThat(customer.count).isEqualTo(16);
    assertThat(shop.count).isZero();
    assertThat(wallets.balanceOf(OWNER)).isEqualTo(10);
  }

  @Test
  void sellingWithoutTheItemsOrToAFullShopMovesNothing() throws Exception {
    wallets.set(OWNER, 100);
    customer.count = 15;
    assertThat(run(deal(Direction.SELL, OWNER, shop)))
        .isEqualTo(new TradeOutcome.Refused(new TradeProblem.NotEnoughItems(15, 16)));

    customer.count = 16;
    shop.count = 60;
    assertThat(run(deal(Direction.SELL, OWNER, shop)))
        .isEqualTo(new TradeOutcome.Refused(new TradeProblem.ShopFull(4, 16)));
    assertThat(wallets.receipts()).isEmpty();
    assertThat(customer.count).isEqualTo(16);
  }

  @Test
  void aShopThatFillsUpWhilePayingRefundsAndReturnsTheItems() throws Exception {
    wallets.set(OWNER, 100);
    customer.count = 16;
    wallets.afterNextTransfer(() -> shop.count = 60);

    var outcome = run(deal(Direction.SELL, OWNER, shop));

    assertThat(outcome).isEqualTo(new TradeOutcome.Refunded(new TradeProblem.ShopFull(4, 16)));
    assertThat(customer.count).isEqualTo(16);
    assertThat(shop.count).isEqualTo(60);
    assertThat(wallets.balanceOf(OWNER)).isEqualTo(100);
    assertThat(wallets.balanceOf(ALICE)).isZero();
  }

  @Test
  void itemsGoBackOnlyAfterTheRefundHasGoneThrough() throws Exception {
    wallets.set(OWNER, 100);
    customer.count = 16;
    var heldAtRefund = new int[] {-1};
    wallets.afterNextTransfer(() -> shop.count = 60);
    wallets.afterNextTransfer(() -> heldAtRefund[0] = customer.count);

    run(deal(Direction.SELL, OWNER, shop));

    assertThat(heldAtRefund[0]).isZero();
    assertThat(customer.count).isEqualTo(16);
  }

  @Test
  void aSellRefundThatFailsLeavesTheItemsWithTheShopNeverTheCustomer() throws Exception {
    wallets.set(OWNER, 100);
    customer.count = 16;
    // While the owner pays, the shop fills up and the customer drains the payment with /pay.
    wallets.afterNextTransfer(
        () -> {
          shop.count = 60;
          wallets.set(ALICE, 0);
        });

    var outcome = run(deal(Direction.SELL, OWNER, shop));

    assertThat(outcome).isInstanceOf(TradeOutcome.RefundFailed.class);
    assertThat(((TradeOutcome.RefundFailed) outcome).problem())
        .isEqualTo(new TradeProblem.ShopFull(4, 16));
    assertThat(customer.count + customer.dropped).isZero();
    assertThat(shop.count).isEqualTo(64);
    assertThat(shop.dropped).isEqualTo(12);
    assertThat(store.refundFailures)
        .singleElement()
        .satisfies(
            failure -> {
              assertThat(failure.payer()).isEqualTo(ALICE);
              assertThat(failure.payee()).isEqualTo(OWNER);
            });
  }

  @Test
  void aCustomerWhoLeftBeforeDeliveryIsRefunded() throws Exception {
    wallets.set(ALICE, 100);
    shop.count = 16;
    // Leaving empties the customer's holdings: no stock, no room.
    wallets.afterNextTransfer(() -> customer.capacity = 0);

    var outcome = run(deal(Direction.BUY, OWNER, shop));

    assertThat(outcome).isEqualTo(new TradeOutcome.Refunded(new TradeProblem.NoRoom(0, 16)));
    assertThat(wallets.balanceOf(ALICE)).isEqualTo(100);
    assertThat(shop.count).isEqualTo(16);
  }

  @Test
  void returnedItemsThatNoLongerFitAreDropped() throws Exception {
    wallets.set(OWNER, 10);
    customer.count = 16;
    // The customer picks up other things while the owner's payment is refused.
    wallets.afterNextTransfer(() -> customer.capacity = 10);

    var outcome = run(deal(Direction.SELL, OWNER, shop));

    assertThat(outcome).isEqualTo(new TradeOutcome.Refused(new TradeProblem.OwnerCannotPay()));
    assertThat(customer.count).isEqualTo(10);
    assertThat(customer.dropped).isEqualTo(6);
  }

  @Test
  void aFailedPaymentWhenSellingReturnsTheItems() {
    wallets.set(OWNER, 100);
    customer.count = 16;
    wallets.failNext(new IllegalStateException("database down"));

    assertThatThrownBy(() -> run(deal(Direction.SELL, OWNER, shop)))
        .isInstanceOf(ExecutionException.class)
        .hasRootCauseMessage("database down");
    assertThat(customer.count).isEqualTo(16);
    assertThat(shop.count).isZero();
  }

  @Test
  void theServerHasEndlessStockAndCrystals() throws Exception {
    wallets.set(ALICE, 50);
    assertThat(run(deal(Direction.BUY, SERVER, Holdings.UNLIMITED)))
        .isInstanceOf(TradeOutcome.Completed.class);
    assertThat(customer.count).isEqualTo(16);
    assertThat(wallets.balanceOf(ALICE)).isZero();

    assertThat(run(deal(Direction.SELL, SERVER, Holdings.UNLIMITED)))
        .isInstanceOf(TradeOutcome.Completed.class);
    assertThat(customer.count).isZero();
    assertThat(wallets.balanceOf(ALICE)).isEqualTo(50);
  }

  @Test
  void ledgerRefusalsBecomeTradeProblems() {
    var buy = deal(Direction.BUY, OWNER, shop);

    assertThat(
            TradeEngine.paymentProblem(
                buy, new EconomyError.InsufficientFunds(ALICE, Crystals.of(1), Crystals.of(50))))
        .isEqualTo(new TradeProblem.CustomerCannotPay(1, 50));
    assertThat(
            TradeEngine.paymentProblem(
                buy, new EconomyError.InsufficientFunds(OWNER, Crystals.of(1), Crystals.of(50))))
        .isEqualTo(new TradeProblem.OwnerCannotPay());
    assertThat(TradeEngine.paymentProblem(buy, new EconomyError.SameAccount(ALICE)))
        .isEqualTo(new TradeProblem.OwnShop());
    assertThatThrownBy(() -> TradeEngine.paymentProblem(buy, new EconomyError.ZeroAmount()))
        .isInstanceOf(IllegalStateException.class);
  }

  @Test
  void aCustomerTradingWithThemselvesIsRefused() throws Exception {
    wallets.set(ALICE, 100);
    shop.count = 16;

    var outcome = run(deal(Direction.BUY, ALICE, shop));

    assertThat(outcome).isEqualTo(new TradeOutcome.Refused(new TradeProblem.OwnShop()));
    assertThat(shop.count).isEqualTo(16);
  }

  @Test
  void dealsValidateThemselves() {
    assertThatThrownBy(
            () ->
                new Deal(
                    Direction.BUY,
                    0,
                    Crystals.of(1),
                    new Deal.Party(ALICE, customer),
                    new Deal.Party(OWNER, shop),
                    "x"))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(
            () ->
                new Deal(
                    Direction.BUY,
                    1,
                    Crystals.ZERO,
                    new Deal.Party(ALICE, customer),
                    new Deal.Party(OWNER, shop),
                    "x"))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
