package com.shepherdjerred.thestorm.economy.domain;

import static java.util.UUID.randomUUID;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.economy.app.AccountId;
import com.shepherdjerred.thestorm.economy.app.Crystals;
import com.shepherdjerred.thestorm.economy.app.EconomyError;
import org.junit.jupiter.api.Test;

final class ExplanationsTest {

  private static final CrystalFormat FORMAT =
      new CrystalFormat(new Currency("crystal", "crystals", "CR"));

  @Test
  void insufficientFundsNamesBothAmounts() {
    var error =
        new EconomyError.InsufficientFunds(
            new AccountId.Player(randomUUID()), Crystals.of(1), Crystals.of(1250));
    assertThat(Explanations.explain(error, FORMAT))
        .isEqualTo("Not enough crystals: that needs 1,250 crystals but the balance is 1 crystal.");
  }

  @Test
  void zeroAmountAsksForAtLeastOne() {
    assertThat(Explanations.explain(new EconomyError.ZeroAmount(), FORMAT))
        .isEqualTo("The amount must be at least 1 crystal.");
  }

  @Test
  void sameAccountRefusesSelfPayment() {
    var error = new EconomyError.SameAccount(new AccountId.Player(randomUUID()));
    assertThat(Explanations.explain(error, FORMAT)).isEqualTo("You can't pay yourself.");
  }
}
