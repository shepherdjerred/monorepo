package com.shepherdjerred.thestorm.arena.domain.survival;

import static com.shepherdjerred.thestorm.arena.testing.Samples.ALICE;
import static com.shepherdjerred.thestorm.arena.testing.Samples.BOB;
import static com.shepherdjerred.thestorm.arena.testing.Samples.T0;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import org.junit.jupiter.api.Test;

final class MysteryBoxTest {
  private static MysteryBox box() {
    return new MysteryBox(List.of("market", "quarry", "bluff"));
  }

  @Test
  void purchaseIsExclusiveAndOnlyBuyerCanClaimDuringRevealWindow() {
    var box = box();
    assertThat(box.start(ALICE, BoxReward.signature(LegendaryWeapon.STORMCALLER), T0)).isTrue();
    assertThat(box.start(BOB, BoxReward.ordinary("BOW", GearRarity.COMMON), T0)).isFalse();
    assertThat(box.claim(ALICE, T0.plusMillis(2999))).isFalse();
    assertThat(box.claim(BOB, T0.plusSeconds(3))).isFalse();
    assertThat(box.claim(ALICE, T0.plusSeconds(3))).isTrue();
    assertThat(box.claim(ALICE, T0.plusSeconds(4))).isFalse();
    assertThat(box.expire(T0.plusSeconds(18))).isEmpty();
  }

  @Test
  void expiryReturnsOneRefundTokenAndCannotBeClaimedAtTheDeadline() {
    var box = box();
    box.start(ALICE, BoxReward.ordinary("BOW", GearRarity.COMMON), T0);
    assertThat(box.expire(T0.plusMillis(17999))).isEmpty();
    assertThat(box.claim(ALICE, T0.plusSeconds(18))).isFalse();
    assertThat(box.expire(T0.plusSeconds(18)))
        .hasValueSatisfying(roll -> assertThat(roll.owner()).isEqualTo(ALICE));
    assertThat(box.expire(T0.plusSeconds(19))).isEmpty();
  }

  @Test
  void departureCancelsOnlyOwnersPurchaseExactlyOnce() {
    var box = box();
    box.start(ALICE, BoxReward.ordinary("BOW", GearRarity.COMMON), T0);
    assertThat(box.cancel(BOB)).isEmpty();
    assertThat(box.cancel(ALICE)).isPresent();
    assertThat(box.cancel(ALICE)).isEmpty();
    assertThat(box.claim(ALICE, T0.plusSeconds(3))).isFalse();
  }

  @Test
  void resetDiscardsPreviousRunRollAndClaimProgress() {
    var box = box();
    box.start(ALICE, BoxReward.ordinary("BOW", GearRarity.COMMON), T0);
    box.claim(ALICE, T0.plusSeconds(3));
    box.start(ALICE, BoxReward.signature(LegendaryWeapon.GRAVITON), T0);
    box.reset();
    assertThat(box.roll()).isEmpty();
    assertThat(box.site()).isEqualTo("market");
    assertThat(box.claim(ALICE, T0.plusSeconds(3))).isFalse();
    assertThat(box.expire(T0.plusSeconds(18))).isEmpty();
    assertThat(box.start(BOB, BoxReward.signature(LegendaryWeapon.FROSTBITE), T0)).isTrue();
  }

  @Test
  void sixClaimsRelocateToAnotherSiteIncludingLockedDestinations() {
    var box = box();
    for (var claim = 0; claim < 6; claim++) {
      assertThat(box.relocate(2)).isFalse();
      box.start(ALICE, BoxReward.ordinary("BOW", GearRarity.COMMON), T0);
      assertThat(box.relocate(2)).isFalse();
      assertThat(box.claim(ALICE, T0.plusSeconds(3))).isTrue();
    }
    assertThat(box.relocate(2)).isTrue();
    assertThat(box.site()).isEqualTo("bluff");
    assertThat(box.relocate(1)).isFalse();
    assertThatThrownBy(() -> box.relocate(0)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> box.relocate(3)).isInstanceOf(IllegalArgumentException.class);
  }
}
