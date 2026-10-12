package com.shepherdjerred.thestorm.economy.domain;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.economy.app.AccountId;
import com.shepherdjerred.thestorm.economy.app.Money;
import java.util.UUID;
import org.junit.jupiter.api.Test;

final class AdjustmentsTest {

  private static final AccountId ALICE = new AccountId.Player(new UUID(0, 1));

  @Test
  void raisingABalancePaysFromTheServer() {
    assertThat(Adjustments.toReach(ALICE, Money.crystals(100), Money.crystals(250)))
        .contains(new Transfer(new AccountId.Server(), ALICE, Money.crystals(150)));
  }

  @Test
  void loweringABalancePaysTheServer() {
    assertThat(Adjustments.toReach(ALICE, Money.crystals(100), Money.crystals(40)))
        .contains(new Transfer(ALICE, new AccountId.Server(), Money.crystals(60)));
  }

  @Test
  void settingToZeroTakesEverything() {
    assertThat(Adjustments.toReach(ALICE, Money.crystals(100), Money.crystals(0)))
        .contains(new Transfer(ALICE, new AccountId.Server(), Money.crystals(100)));
  }

  @Test
  void anUnchangedBalanceNeedsNoTransfer() {
    assertThat(Adjustments.toReach(ALICE, Money.crystals(100), Money.crystals(100))).isEmpty();
  }

  @Test
  void theAdjustmentAlwaysPassesTheRules() {
    var rules = TransferRules.standard();
    var current = Money.crystals(75);
    for (var target : new long[] {0, 1, 74, 76, 10_000}) {
      var transfer = Adjustments.toReach(ALICE, current, Money.crystals(target)).orElseThrow();
      var payerBalance = transfer.from().equals(ALICE) ? current : Money.crystals(0);
      var payeeBalance = transfer.to().equals(ALICE) ? current : Money.crystals(0);
      var settled = rules.settle(new PendingTransfer(transfer, payerBalance, payeeBalance));
      assertThat(settled.isOk()).isTrue();
      assertThat(settled.map(s -> s.updates().getFirst().balance()))
          .isEqualTo(Result.ok(Money.crystals(target)));
    }
  }
}
