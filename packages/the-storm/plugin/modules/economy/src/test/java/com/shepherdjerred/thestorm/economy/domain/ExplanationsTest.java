package com.shepherdjerred.thestorm.economy.domain;

import static java.util.UUID.randomUUID;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.economy.app.AccountId;
import com.shepherdjerred.thestorm.economy.app.CurrencyId;
import com.shepherdjerred.thestorm.economy.app.EconomyError;
import com.shepherdjerred.thestorm.economy.app.Money;
import org.junit.jupiter.api.Test;

final class ExplanationsTest {

  private static final MoneyFormat FORMAT = MoneyFormatTest.FORMAT;

  @Test
  void insufficientFundsNamesBothAmounts() {
    var error =
        new EconomyError.InsufficientFunds(
            new AccountId.Player(randomUUID()), Money.crystals(1), Money.crystals(1250));
    assertThat(Explanations.explain(error, FORMAT))
        .isEqualTo("Not enough crystals: that needs 1,250 crystals but the balance is 1 crystal.");
  }

  @Test
  void insufficientFundsUsesTheTransfersCurrency() {
    var error =
        new EconomyError.InsufficientFunds(
            new AccountId.Player(randomUUID()), Money.rwfCredits(0), Money.rwfCredits(150));
    assertThat(Explanations.explain(error, FORMAT))
        .isEqualTo("Not enough Credits: that needs 150 Credits but the balance is 0 Credits.");
  }

  @Test
  void zeroAmountAsksForAtLeastOne() {
    assertThat(Explanations.explain(new EconomyError.ZeroAmount(CurrencyId.CRYSTALS), FORMAT))
        .isEqualTo("The amount must be at least 1 crystal.");
    assertThat(Explanations.explain(new EconomyError.ZeroAmount(CurrencyId.RWF_CREDITS), FORMAT))
        .isEqualTo("The amount must be at least 1 Credit.");
  }

  @Test
  void sameAccountRefusesSelfPayment() {
    var error = new EconomyError.SameAccount(new AccountId.Player(randomUUID()));
    assertThat(Explanations.explain(error, FORMAT)).isEqualTo("You can't pay yourself.");
  }
}
