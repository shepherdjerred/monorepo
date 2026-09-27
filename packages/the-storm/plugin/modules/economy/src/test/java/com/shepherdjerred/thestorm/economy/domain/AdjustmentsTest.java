package com.shepherdjerred.thestorm.economy.domain;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.economy.app.AccountId;
import com.shepherdjerred.thestorm.economy.app.Crystals;
import java.util.UUID;
import org.junit.jupiter.api.Test;

final class AdjustmentsTest {

  private static final AccountId ALICE = new AccountId.Player(new UUID(0, 1));

  @Test
  void raisingABalancePaysFromTheServer() {
    assertThat(Adjustments.toReach(ALICE, Crystals.of(100), Crystals.of(250)))
        .contains(new Transfer(new AccountId.Server(), ALICE, Crystals.of(150)));
  }

  @Test
  void loweringABalancePaysTheServer() {
    assertThat(Adjustments.toReach(ALICE, Crystals.of(100), Crystals.of(40)))
        .contains(new Transfer(ALICE, new AccountId.Server(), Crystals.of(60)));
  }

  @Test
  void settingToZeroTakesEverything() {
    assertThat(Adjustments.toReach(ALICE, Crystals.of(100), Crystals.ZERO))
        .contains(new Transfer(ALICE, new AccountId.Server(), Crystals.of(100)));
  }

  @Test
  void anUnchangedBalanceNeedsNoTransfer() {
    assertThat(Adjustments.toReach(ALICE, Crystals.of(100), Crystals.of(100))).isEmpty();
  }

  @Test
  void theAdjustmentAlwaysPassesTheRules() {
    var rules = TransferRules.standard();
    var current = Crystals.of(75);
    for (var target : new long[] {0, 1, 74, 76, 10_000}) {
      var transfer = Adjustments.toReach(ALICE, current, Crystals.of(target)).orElseThrow();
      var payerBalance = transfer.from().equals(ALICE) ? current : Crystals.ZERO;
      var payeeBalance = transfer.to().equals(ALICE) ? current : Crystals.ZERO;
      var settled = rules.settle(new PendingTransfer(transfer, payerBalance, payeeBalance));
      assertThat(settled.isOk()).isTrue();
      assertThat(settled.map(s -> s.updates().getFirst().balance()))
          .isEqualTo(Result.ok(Crystals.of(target)));
    }
  }
}
