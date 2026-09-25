package com.shepherdjerred.thestorm.shops.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.shops.domain.price.ShopPrices;
import com.shepherdjerred.thestorm.shops.domain.shop.BlockPos;
import com.shepherdjerred.thestorm.shops.domain.shop.ItemFingerprint;
import com.shepherdjerred.thestorm.shops.domain.shop.ShopOwner;
import com.shepherdjerred.thestorm.shops.domain.shop.SignShop;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.OptionalLong;
import java.util.UUID;
import org.junit.jupiter.api.Test;

final class ShopRegistryTest {

  private static final UUID WORLD = new UUID(9, 9);
  private static final UUID ALICE = new UUID(0, 1);
  private static final UUID BOB = new UUID(0, 2);
  private static final BlockPos CHEST = new BlockPos(WORLD, 0, 64, 0);

  private static SignShop shop(long id, UUID owner, int signX) {
    return new SignShop(
        id,
        new BlockPos(WORLD, signX, 65, 0),
        Optional.of(CHEST),
        new ShopOwner.Player(owner, "p"),
        1,
        ShopPrices.buyOnly(1),
        Optional.empty(),
        Instant.EPOCH);
  }

  @Test
  void indexesShopsBySignContainerAndOwner() {
    var first = shop(3, ALICE, 1);
    var second = shop(7, ALICE, 2);
    var registry = new ShopRegistry(List.of(first, second));

    assertThat(registry.atSign(first.sign())).contains(first);
    assertThat(registry.byId(7)).contains(second);
    assertThat(registry.tradingFrom(CHEST)).containsExactly(first, second);
    assertThat(registry.ownedBy(ALICE)).isEqualTo(2);
    assertThat(registry.shopsOf(ALICE)).containsExactlyInAnyOrder(first, second);
    assertThat(registry.ownedBy(BOB)).isZero();
    assertThat(registry.nextId()).isEqualTo(8);
  }

  @Test
  void idsAreNeverReused() {
    var registry = new ShopRegistry(List.of(shop(1, ALICE, 1)));

    registry.remove(1);

    assertThat(registry.nextId()).isEqualTo(2);
    assertThat(registry.tradingFrom(CHEST)).isEmpty();
    assertThat(registry.atSign(new BlockPos(WORLD, 1, 65, 0))).isEmpty();
  }

  @Test
  void removingAnUnknownShopDoesNothing() {
    var registry = new ShopRegistry(List.of(shop(1, ALICE, 1)));

    registry.remove(99);

    assertThat(registry.ownedBy(ALICE)).isEqualTo(1);
  }

  @Test
  void aSignOrIdHoldsOneShop() {
    var registry = new ShopRegistry(List.of(shop(1, ALICE, 1)));

    assertThatThrownBy(() -> registry.add(shop(1, ALICE, 9)))
        .isInstanceOf(IllegalStateException.class);
    assertThatThrownBy(() -> registry.add(shop(2, ALICE, 1)))
        .isInstanceOf(IllegalStateException.class);
  }

  @Test
  void replacingKeepsTheShopInPlace() {
    var original = shop(1, ALICE, 1);
    var registry = new ShopRegistry(List.of(original));
    var stocked = original.withItem(new ItemFingerprint("coal", "x", false));

    registry.replace(stocked);

    assertThat(registry.atSign(original.sign())).contains(stocked);
    assertThatThrownBy(() -> registry.replace(shop(1, ALICE, 5)))
        .isInstanceOf(IllegalStateException.class);
  }

  @Test
  void containerOwnershipCoversEveryShopOnIt() {
    var registry = new ShopRegistry(List.of(shop(1, ALICE, 1)));

    assertThat(registry.ownsAllOn(ALICE, CHEST)).isTrue();
    assertThat(registry.ownsAllOn(BOB, CHEST)).isFalse();
    assertThat(registry.ownsAllOn(BOB, new BlockPos(WORLD, 50, 64, 0))).isTrue();
  }

  @Test
  void locksHoldTheShopAndCustomerUntilReleased() {
    var locks = new ShopLocks();

    var lease = locks.acquire(OptionalLong.of(1), ALICE).orElseThrow();

    assertThat(locks.isBusy(1)).isTrue();
    assertThat(locks.acquire(OptionalLong.of(1), BOB)).isEmpty();
    assertThat(locks.acquire(OptionalLong.of(2), ALICE)).isEmpty();
    assertThat(locks.acquire(OptionalLong.empty(), ALICE)).isEmpty();
    lease.release();
    assertThat(locks.isBusy(1)).isFalse();
    assertThat(locks.acquire(OptionalLong.of(1), BOB)).isPresent();
    assertThatThrownBy(lease::release).isInstanceOf(IllegalStateException.class);
  }
}
