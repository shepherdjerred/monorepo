package com.shepherdjerred.thestorm.essentials.domain.kit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.result.Result;
import java.time.Duration;
import java.time.Instant;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;

final class KitTest {

  static final Instant T0 = Instant.parse("2026-09-25T12:00:00Z");
  static final KitItem BREAD = new KitItem("BREAD", 16, Optional.empty(), Map.of());

  static Kit daily() {
    return new Kit(List.of(BREAD), List.of(), Duration.ofHours(24), false);
  }

  static Kit starter() {
    return new Kit(List.of(BREAD), List.of(), Duration.ZERO, true);
  }

  @Test
  void aKitNeverClaimedCanBeClaimed() {
    assertThat(KitRules.claim(daily(), Optional.empty(), T0)).isEqualTo(Result.ok(T0));
    assertThat(KitRules.claim(starter(), Optional.empty(), T0)).isEqualTo(Result.ok(T0));
  }

  @Test
  void aOnceOnlyKitCanNeverBeClaimedAgain() {
    assertThat(KitRules.claim(starter(), Optional.of(T0), T0.plus(Duration.ofDays(3650))))
        .isEqualTo(Result.err(new KitError.AlreadyClaimed()));
  }

  @Test
  void theCooldownRefusesUntilItsExactEnd() {
    var last = Optional.of(T0);

    assertThat(KitRules.claim(daily(), last, T0.plus(Duration.ofHours(24)).minusMillis(1)))
        .isEqualTo(Result.err(new KitError.OnCooldown(Duration.ofMillis(1))));
    assertThat(KitRules.claim(daily(), last, T0.plus(Duration.ofHours(24))))
        .isEqualTo(Result.ok(T0.plus(Duration.ofHours(24))));
  }

  @Test
  void aZeroCooldownKitCanBeClaimedAgainAtOnce() {
    var kit = new Kit(List.of(BREAD), List.of(), Duration.ZERO, false);

    assertThat(KitRules.claim(kit, Optional.of(T0), T0)).isEqualTo(Result.ok(T0));
  }

  @Test
  void kitsMustHoldSomething() {
    assertThatThrownBy(() -> new Kit(List.of(), List.of(), Duration.ZERO, false))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new Kit(List.of(BREAD), List.of(), Duration.ofSeconds(-1), false))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void itemsValidateTheirShape() {
    assertThatThrownBy(() -> new KitItem("bread", 1, Optional.empty(), Map.of()))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new KitItem("BREAD", 0, Optional.empty(), Map.of()))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new KitItem("BREAD", 65, Optional.empty(), Map.of()))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new KitItem("BREAD", 1, Optional.of(" "), Map.of()))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(
            () -> new KitItem("IRON_SWORD", 1, Optional.empty(), Map.of("Sharp ness", 1)))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new KitItem("IRON_SWORD", 1, Optional.empty(), Map.of("sharpness", 0)))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void itemsAcceptNamesAndNamespacedEnchantments() {
    var sword =
        new KitItem(
            "IRON_SWORD",
            1,
            Optional.of("<aqua>Storm Blade"),
            Map.of("minecraft:sharpness", 2, "unbreaking", 1));

    assertThat(sword.enchantments()).containsEntry("minecraft:sharpness", 2).hasSize(2);
  }

  @Test
  void booksRespectTheGamesLimits() {
    var page = List.of("Hello");
    assertThat(new BookContent("Welcome", "The Storm", page).pages()).containsExactly("Hello");
    assertThatThrownBy(() -> new BookContent("x".repeat(33), "The Storm", page))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new BookContent("Title", " ", page))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new BookContent("Title", "Me", List.of()))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new BookContent("Title", "Me", List.of(" ")))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new BookContent("Title", "Me", Collections.nCopies(101, "p")))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
