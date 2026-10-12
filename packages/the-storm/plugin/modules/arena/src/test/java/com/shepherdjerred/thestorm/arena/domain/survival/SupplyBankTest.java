package com.shepherdjerred.thestorm.arena.domain.survival;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.Map;
import org.junit.jupiter.api.Test;

final class SupplyBankTest {
  @Test
  void aPaymentUsesCarriedSuppliesFirstAndTracksBothSources() {
    var bank = new SupplyBank();
    bank.deposit("EMERALD", 20);
    bank.deposit("IRON_INGOT", 6);
    var payment =
        bank.pay(Map.of("EMERALD", 12, "IRON_INGOT", 4), Map.of("EMERALD", 8)).orElseThrow();
    assertThat(payment.carried()).containsExactlyEntriesOf(Map.of("EMERALD", 8));
    assertThat(payment.banked()).containsExactlyEntriesOf(Map.of("EMERALD", 4, "IRON_INGOT", 4));
    assertThat(bank.balances()).containsExactlyEntriesOf(Map.of("EMERALD", 16, "IRON_INGOT", 2));
  }

  @Test
  void anUnaffordableBundleDoesNotConsumeAnyTeamSupplies() {
    var bank = new SupplyBank();
    bank.deposit("EMERALD", 20);
    var before = bank.balances();
    assertThat(bank.pay(Map.of("EMERALD", 10, "IRON_INGOT", 2), Map.of())).isEmpty();
    assertThat(bank.balances()).isEqualTo(before);
  }

  @Test
  void twoTeammatesCannotSpendTheSameBalance() {
    var bank = new SupplyBank();
    bank.deposit("EMERALD", 12);
    assertThat(bank.pay(Map.of("EMERALD", 12), Map.of())).isPresent();
    assertThat(bank.pay(Map.of("EMERALD", 12), Map.of())).isEmpty();
    assertThat(bank.count("EMERALD")).isZero();
  }

  @Test
  void withdrawalsAndBalanceViewsCannotCreateOrDestroySupplies() {
    var bank = new SupplyBank();
    bank.deposit("WHEAT", 4);
    assertThat(bank.withdraw("WHEAT", 5)).isFalse();
    assertThat(bank.count("WHEAT")).isEqualTo(4);
    assertThatThrownBy(() -> bank.balances().put("WHEAT", 50))
        .isInstanceOf(UnsupportedOperationException.class);
    assertThat(bank.withdraw("WHEAT", 4)).isTrue();
    assertThat(bank.balances()).isEmpty();
    assertThatThrownBy(() -> bank.withdraw("WHEAT", -1))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
