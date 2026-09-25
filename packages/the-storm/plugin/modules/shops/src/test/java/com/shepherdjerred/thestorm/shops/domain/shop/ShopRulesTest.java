package com.shepherdjerred.thestorm.shops.domain.shop;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.shops.domain.price.ShopPrices;
import com.shepherdjerred.thestorm.shops.domain.sign.OwnerLine;
import com.shepherdjerred.thestorm.shops.domain.sign.SignLines;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

final class ShopRulesTest {

  private static final ShopLimits LIMITS = new ShopLimits(Map.of(1, 5, 2, 10, 3, 20, 4, 35, 5, 50));
  private static final CreationRules RULES = CreationRules.standard(LIMITS);
  private static final UUID WORLD = new UUID(9, 9);
  private static final UUID ALICE = new UUID(0, 1);

  private static CreationAttempt player(int level, int owned, CreationAttempt.Container container) {
    return new CreationAttempt(new OwnerLine.Creator(), false, level, owned, container);
  }

  @ParameterizedTest
  @CsvSource({"0,0", "1,5", "2,10", "3,20", "4,35", "5,50"})
  void limitsFollowTheShopkeeperLevel(int level, int allowed) {
    assertThat(LIMITS.allowed(level)).isEqualTo(allowed);
  }

  @Test
  void limitsCoverEveryLevelAndNeverShrink() {
    assertThatThrownBy(() -> new ShopLimits(Map.of(1, 5, 2, 10, 3, 20, 4, 35)))
        .hasMessageContaining("level 5");
    assertThatThrownBy(() -> new ShopLimits(Map.of(1, 5, 2, 4, 3, 20, 4, 35, 5, 50)))
        .hasMessageContaining("level 2");
    assertThatThrownBy(() -> new ShopLimits(Map.of(1, 0, 2, 4, 3, 20, 4, 35, 5, 50)))
        .hasMessageContaining("level 1");
    assertThatThrownBy(() -> new ShopLimits(Map.of(1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6)))
        .hasMessageContaining("1..5 only");
    assertThatThrownBy(() -> LIMITS.allowed(6)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> LIMITS.allowed(-1)).isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void theHighestGrantedLevelCounts() {
    assertThat(ShopLimits.highestLevel(level -> level <= 3)).isEqualTo(3);
    assertThat(ShopLimits.highestLevel(level -> level == 5)).isEqualTo(5);
    assertThat(ShopLimits.highestLevel(level -> false)).isZero();
  }

  @Test
  void aShopkeeperUnderTheLimitMayOpenAChestShop() {
    assertThat(RULES.check(player(1, 4, CreationAttempt.Container.FREE))).isEmpty();
  }

  @Test
  void untrainedPlayersMayNotOpenChestShops() {
    assertThat(RULES.check(player(0, 0, CreationAttempt.Container.FREE)))
        .containsExactly(new CreationProblem.NotShopkeeper());
  }

  @Test
  void theLimitStopsTheNextShop() {
    assertThat(RULES.check(player(1, 5, CreationAttempt.Container.FREE)))
        .containsExactly(new CreationProblem.LimitReached(5));
    assertThat(RULES.check(player(2, 5, CreationAttempt.Container.FREE))).isEmpty();
  }

  @Test
  void chestShopsNeedTheirOwnContainer() {
    assertThat(RULES.check(player(1, 0, CreationAttempt.Container.NONE)))
        .containsExactly(new CreationProblem.NoContainer());
    assertThat(RULES.check(player(1, 0, CreationAttempt.Container.TAKEN)))
        .containsExactly(new CreationProblem.ContainerTaken());
  }

  @Test
  void everyBrokenRuleIsReported() {
    assertThat(RULES.check(player(0, 0, CreationAttempt.Container.NONE)))
        .containsExactly(new CreationProblem.NotShopkeeper(), new CreationProblem.NoContainer());
  }

  @Test
  void adminShopsNeedAdminButNoContainerOrTrack() {
    var admin =
        new CreationAttempt(new OwnerLine.AdminShop(), true, 0, 99, CreationAttempt.Container.NONE);
    var notAdmin =
        new CreationAttempt(new OwnerLine.AdminShop(), false, 5, 0, CreationAttempt.Container.NONE);
    var onSomeonesChest =
        new CreationAttempt(new OwnerLine.AdminShop(), true, 0, 0, CreationAttempt.Container.TAKEN);

    assertThat(RULES.check(admin)).isEmpty();
    assertThat(RULES.check(notAdmin)).containsExactly(new CreationProblem.NotAdmin());
    assertThat(RULES.check(onSomeonesChest)).containsExactly(new CreationProblem.ContainerTaken());
  }

  @Test
  void attemptsValidateThemselves() {
    assertThatThrownBy(() -> player(6, 0, CreationAttempt.Container.FREE))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> player(1, -1, CreationAttempt.Container.FREE))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void creationProblemsDescribeThemselves() {
    assertThat(new CreationProblem.LimitReached(1).describe()).contains("1 shop,");
    assertThat(new CreationProblem.LimitReached(5).describe()).contains("5 shops,");
    assertThat(
            List.<CreationProblem>of(
                new CreationProblem.NotAdmin(),
                new CreationProblem.NotShopkeeper(),
                new CreationProblem.NoContainer(),
                new CreationProblem.ContainerTaken()))
        .allSatisfy(problem -> assertThat(problem.describe()).isNotBlank());
  }

  @Test
  void facingsTurnBothWays() {
    for (var facing : Facing.values()) {
      assertThat(facing.clockwise().counterClockwise()).isEqualTo(facing);
      assertThat(facing.clockwise().clockwise().clockwise().clockwise()).isEqualTo(facing);
    }
    assertThat(Facing.NORTH.clockwise()).isEqualTo(Facing.EAST);
    assertThat(Facing.NORTH.counterClockwise()).isEqualTo(Facing.WEST);
  }

  @Test
  void doubleChestHalvesPointAtEachOther() {
    var chest = new BlockPos(WORLD, 0, 64, 0);

    // A chest facing north: its left half joins to the east, its right half to the west.
    assertThat(DoubleChests.otherHalf(chest, Facing.NORTH, DoubleChests.Half.LEFT))
        .contains(new BlockPos(WORLD, 1, 64, 0));
    assertThat(DoubleChests.otherHalf(chest, Facing.NORTH, DoubleChests.Half.RIGHT))
        .contains(new BlockPos(WORLD, -1, 64, 0));
    assertThat(DoubleChests.otherHalf(chest, Facing.EAST, DoubleChests.Half.LEFT))
        .contains(new BlockPos(WORLD, 0, 64, 1));
    assertThat(DoubleChests.otherHalf(chest, Facing.SOUTH, DoubleChests.Half.SINGLE)).isEmpty();
  }

  @Test
  void theTwoHalvesOfADoubleChestFindEachOther() {
    for (var facing : Facing.values()) {
      var left = new BlockPos(WORLD, 5, 70, 5);
      var right = DoubleChests.otherHalf(left, facing, DoubleChests.Half.LEFT).orElseThrow();

      assertThat(DoubleChests.otherHalf(right, facing, DoubleChests.Half.RIGHT)).contains(left);
    }
  }

  @Test
  void blockPositionsMove() {
    var pos = new BlockPos(WORLD, 1, 2, 3);

    assertThat(pos.offset(1, -1, 0)).isEqualTo(new BlockPos(WORLD, 2, 1, 3));
    assertThat(pos.toward(Facing.SOUTH)).isEqualTo(new BlockPos(WORLD, 1, 2, 4));
  }

  @Test
  void aSignShopShowsItsOwnerPricesAndItem() {
    var shop =
        new SignShop(
            1,
            new BlockPos(WORLD, 0, 65, 1),
            Optional.of(new BlockPos(WORLD, 0, 65, 0)),
            new ShopOwner.Player(ALICE, "Alice"),
            16,
            ShopPrices.both(50, 40),
            Optional.empty(),
            Instant.EPOCH);

    assertThat(shop.lines("Admin Shop")).isEqualTo(SignLines.of("Alice", "16", "B 50:S 40", "?"));
    var stocked = shop.withItem(new ItemFingerprint("diamond_sword", "abc", true));
    assertThat(stocked.lines("Admin Shop").item()).isEqualTo("Diamond Sword*");
    assertThat(shop.isAdmin()).isFalse();
    assertThat(shop.owner().isOwnedBy(ALICE)).isTrue();
    assertThat(shop.owner().isOwnedBy(new UUID(0, 2))).isFalse();
  }

  @Test
  void adminShopsShowTheLabelAndNeedNoContainer() {
    var shop =
        new SignShop(
            2,
            new BlockPos(WORLD, 0, 65, 1),
            Optional.empty(),
            new ShopOwner.Admin(),
            1,
            ShopPrices.sellOnly(12),
            Optional.of(new ItemFingerprint("emerald", "abc", false)),
            Instant.EPOCH);

    assertThat(shop.lines("Admin Shop"))
        .isEqualTo(SignLines.of("Admin Shop", "1", "S 12", "Emerald"));
    assertThat(shop.isAdmin()).isTrue();
    assertThat(shop.owner().isOwnedBy(ALICE)).isFalse();
  }

  @Test
  void signShopsValidateThemselves() {
    var sign = new BlockPos(WORLD, 0, 0, 0);
    var owner = new ShopOwner.Player(ALICE, "Alice");
    var prices = ShopPrices.buyOnly(1);
    assertThatThrownBy(
            () ->
                new SignShop(
                    0, sign, Optional.of(sign), owner, 1, prices, Optional.empty(), Instant.EPOCH))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(
            () ->
                new SignShop(
                    1, sign, Optional.of(sign), owner, 0, prices, Optional.empty(), Instant.EPOCH))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(
            () ->
                new SignShop(
                    1, sign, Optional.empty(), owner, 1, prices, Optional.empty(), Instant.EPOCH))
        .hasMessageContaining("needs a container");
    assertThatThrownBy(() -> new ItemFingerprint(" ", "x", false))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
