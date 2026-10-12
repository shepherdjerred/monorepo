package com.shepherdjerred.thestorm.economy.domain;

import static java.util.UUID.randomUUID;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.economy.app.AccountId;
import com.shepherdjerred.thestorm.economy.app.CurrencyId;
import com.shepherdjerred.thestorm.economy.app.EconomyError;
import com.shepherdjerred.thestorm.economy.app.Money;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

final class TransferRulesTest {

  private static final AccountId ALICE = new AccountId.Player(new UUID(0, 1));
  private static final AccountId BOB = new AccountId.Player(new UUID(0, 2));
  private static final AccountId TOWN = new AccountId.Town(new UUID(1, 1));
  private static final AccountId SERVER = new AccountId.Server();

  private final TransferRules rules = TransferRules.standard();

  private static Transfer transfer(AccountId from, AccountId to, long amount) {
    return new Transfer(from, to, Money.crystals(amount));
  }

  private static PendingTransfer pending(Transfer transfer, long payerBalance, long payeeBalance) {
    return new PendingTransfer(
        transfer, Money.crystals(payerBalance), Money.crystals(payeeBalance));
  }

  @Test
  void positiveAmountRuleRefusesZero() {
    var zero = pending(transfer(ALICE, BOB, 0), 100, 0);
    assertThat(new PositiveAmountRule().check(zero))
        .isEqualTo(Result.err(new EconomyError.ZeroAmount(CurrencyId.CRYSTALS)));
  }

  @Test
  void positiveAmountRulePassesOneCrystal() {
    var one = pending(transfer(ALICE, BOB, 1), 0, 0);
    assertThat(new PositiveAmountRule().check(one)).isEqualTo(Result.ok(one));
  }

  @Test
  void distinctAccountsRuleRefusesPayingYourself() {
    var self = pending(transfer(ALICE, ALICE, 5), 100, 100);
    assertThat(new DistinctAccountsRule().check(self))
        .isEqualTo(Result.err(new EconomyError.SameAccount(ALICE)));
  }

  @Test
  void distinctAccountsRuleRefusesServerToServer() {
    var self = pending(transfer(SERVER, SERVER, 5), 0, 0);
    assertThat(new DistinctAccountsRule().check(self))
        .isEqualTo(Result.err(new EconomyError.SameAccount(SERVER)));
  }

  @Test
  void distinctAccountsRuleTellsAPlayerFromATownWithTheSameUuid() {
    var uuid = randomUUID();
    var mixed = pending(transfer(new AccountId.Player(uuid), new AccountId.Town(uuid), 5), 10, 0);
    assertThat(new DistinctAccountsRule().check(mixed)).isEqualTo(Result.ok(mixed));
  }

  @Test
  void sufficientFundsRuleRefusesAShortfall() {
    var short1 = pending(transfer(ALICE, BOB, 101), 100, 0);
    assertThat(new SufficientFundsRule().check(short1))
        .isEqualTo(
            Result.err(
                new EconomyError.InsufficientFunds(
                    ALICE, Money.crystals(100), Money.crystals(101))));
  }

  @Test
  void sufficientFundsRuleAllowsSpendingEverything() {
    var exact = pending(transfer(ALICE, BOB, 100), 100, 0);
    assertThat(new SufficientFundsRule().check(exact)).isEqualTo(Result.ok(exact));
  }

  @Test
  void sufficientFundsRuleAppliesToTowns() {
    var broke = pending(transfer(TOWN, ALICE, 1), 0, 0);
    assertThat(new SufficientFundsRule().check(broke))
        .isEqualTo(
            Result.err(
                new EconomyError.InsufficientFunds(TOWN, Money.crystals(0), Money.crystals(1))));
  }

  @Test
  void sufficientFundsRuleNeverLimitsTheServer() {
    var huge = pending(transfer(SERVER, ALICE, Long.MAX_VALUE / 2), 0, 0);
    assertThat(new SufficientFundsRule().check(huge)).isEqualTo(Result.ok(huge));
  }

  @Test
  void validatorReportsTheFirstRefusalInOrder() {
    var everythingWrong = pending(transfer(ALICE, ALICE, 0), 0, 0);
    assertThat(rules.validate(everythingWrong))
        .isEqualTo(Result.err(new EconomyError.ZeroAmount(CurrencyId.CRYSTALS)));

    var selfAndShort = pending(transfer(ALICE, ALICE, 10), 0, 0);
    assertThat(rules.validate(selfAndShort))
        .isEqualTo(Result.err(new EconomyError.SameAccount(ALICE)));
  }

  @Test
  void validatorComposesCustomRules() {
    TransferRule neverOnTowns =
        pending ->
            pending.transfer().to() instanceof AccountId.Town
                ? Result.err(new EconomyError.ZeroAmount(CurrencyId.CRYSTALS))
                : Result.ok(pending);
    var custom = new TransferRules(List.of(neverOnTowns));
    assertThat(custom.validate(pending(transfer(ALICE, TOWN, 1), 1, 0)).isOk()).isFalse();
    assertThat(custom.validate(pending(transfer(ALICE, BOB, 1), 1, 0)).isOk()).isTrue();
  }

  @Test
  void settlingPlayerToPlayerUpdatesBothBalances() {
    var result = rules.settle(pending(transfer(ALICE, BOB, 30), 100, 5));
    assertThat(result)
        .isEqualTo(
            Result.ok(
                new Settlement(
                    new Transfer(ALICE, BOB, Money.crystals(30)),
                    List.of(
                        new BalanceUpdate(ALICE, Money.crystals(70)),
                        new BalanceUpdate(BOB, Money.crystals(35))))));
  }

  @Test
  void settlingFromTheServerOnlyUpdatesThePayee() {
    var result = rules.settle(pending(transfer(SERVER, ALICE, 500), 0, 0));
    assertThat(result)
        .isEqualTo(
            Result.ok(
                new Settlement(
                    new Transfer(SERVER, ALICE, Money.crystals(500)),
                    List.of(new BalanceUpdate(ALICE, Money.crystals(500))))));
  }

  @Test
  void settlingToTheServerOnlyUpdatesThePayer() {
    var result = rules.settle(pending(transfer(TOWN, SERVER, 40), 40, 0));
    assertThat(result)
        .isEqualTo(
            Result.ok(
                new Settlement(
                    new Transfer(TOWN, SERVER, Money.crystals(40)),
                    List.of(new BalanceUpdate(TOWN, Money.crystals(0))))));
  }

  @Test
  void aRefusedTransferSettlesNothing() {
    assertThat(rules.settle(pending(transfer(ALICE, BOB, 1), 0, 0)).isOk()).isFalse();
  }

  @Test
  void balanceUpdatesNeverTargetTheServer() {
    assertThatThrownBy(() -> new BalanceUpdate(SERVER, Money.crystals(0)))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void balancesMustBeInTheTransfersCurrency() {
    var credits = new Transfer(ALICE, BOB, Money.rwfCredits(3));
    assertThatThrownBy(() -> new PendingTransfer(credits, Money.crystals(10), Money.rwfCredits(0)))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new PendingTransfer(credits, Money.rwfCredits(10), Money.crystals(0)))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void anotherCurrencySettlesTheSameWay() {
    var credits = new Transfer(ALICE, BOB, Money.rwfCredits(3));
    assertThat(rules.settle(new PendingTransfer(credits, Money.rwfCredits(2), Money.rwfCredits(0))))
        .isEqualTo(
            Result.err(
                new EconomyError.InsufficientFunds(
                    ALICE, Money.rwfCredits(2), Money.rwfCredits(3))));
    assertThat(rules.settle(new PendingTransfer(credits, Money.rwfCredits(5), Money.rwfCredits(1))))
        .isEqualTo(
            Result.ok(
                new Settlement(
                    credits,
                    List.of(
                        new BalanceUpdate(ALICE, Money.rwfCredits(2)),
                        new BalanceUpdate(BOB, Money.rwfCredits(4))))));
  }

  @Test
  void amountsOfDifferentCurrenciesNeverMix() {
    assertThatThrownBy(() -> Money.crystals(5).plus(Money.rwfCredits(1)))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> Money.crystals(5).minus(Money.rwfCredits(1)))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> Money.crystals(5).isAtLeast(Money.rwfCredits(1)))
        .isInstanceOf(IllegalArgumentException.class);
    assertThat(Money.crystals(5)).isNotEqualTo(Money.rwfCredits(5));
  }

  @Test
  void onlyPlayersAndTownsHoldBalances() {
    assertThat(Accounts.hasBalance(ALICE)).isTrue();
    assertThat(Accounts.hasBalance(TOWN)).isTrue();
    assertThat(Accounts.hasBalance(SERVER)).isFalse();
  }
}
