package com.shepherdjerred.thestorm.rwfbots.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.time.InstantSource;
import java.util.Optional;
import org.bukkit.Material;
import org.bukkit.attribute.Attribute;
import org.bukkit.enchantments.Enchantment;
import org.bukkit.inventory.ItemStack;
import org.bukkit.potion.PotionEffect;
import org.bukkit.potion.PotionEffectType;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.entity.PlayerMock;

final class TraversalCaptureTest {
  private PlayerMock player;

  @BeforeEach
  void start() {
    player = TraversalPlayerMock.add(MockBukkit.mock(), "Traversal");
  }

  @AfterEach
  void stop() {
    MockBukkit.unmock();
  }

  @Test
  void actualKitAttributesProtectionEffectsAndActionableHealingReachTheSnapshot() {
    java.util.Objects.requireNonNull(player.getAttribute(Attribute.SAFE_FALL_DISTANCE))
        .setBaseValue(4);
    java.util.Objects.requireNonNull(player.getAttribute(Attribute.FALL_DAMAGE_MULTIPLIER))
        .setBaseValue(0.5);
    var boots = new ItemStack(Material.DIAMOND_BOOTS);
    boots.addUnsafeEnchantment(Enchantment.FEATHER_FALLING, 4);
    boots.addUnsafeEnchantment(Enchantment.PROTECTION, 2);
    player.getInventory().setBoots(boots);
    player.getInventory().setItem(0, new ItemStack(Material.COOKED_BEEF, 3));
    player.getInventory().setItem(8, new ItemStack(Material.GOLDEN_APPLE, 2));
    player.getInventory().setItem(9, new ItemStack(Material.GOLDEN_APPLE, 10));
    player.addPotionEffect(new PotionEffect(PotionEffectType.RESISTANCE, 40, 1));
    player.addPotionEffect(new PotionEffect(PotionEffectType.REGENERATION, 20, 0));
    player.addPotionEffect(new PotionEffect(PotionEffectType.JUMP_BOOST, 10, 2));
    player.addPotionEffect(new PotionEffect(PotionEffectType.SLOW_FALLING, 5, 0));
    player.setFallDistance(4.25f);
    var capture =
        new TraversalCapture(
            id -> Optional.of(Instant.EPOCH.plusMillis(3499)), InstantSource.fixed(Instant.EPOCH));
    var state = capture.capture(player, "juggernaut", 100);
    assertThat(state.maySprint()).isFalse();
    assertThat(state.safeFallDistance()).isEqualTo(4);
    assertThat(state.fallDamageMultiplier()).isEqualTo(0.5);
    assertThat(state.fallProtectionPoints()).isEqualTo(14);
    assertThat(state.resistanceAmplifier()).isEqualTo(1);
    assertThat(state.resistanceUntilTick()).isEqualTo(140);
    assertThat(state.noFallUntilTick()).isEqualTo(169);
    assertThat(state.slowFallingUntilTick()).isEqualTo(105);
    assertThat(state.healingConsumables()).isEqualTo(5);
    assertThat(state.regenerationAmplifier()).isZero();
    assertThat(state.regenerationUntilTick()).isEqualTo(120);
    assertThat(state.jumpBoostAmplifier()).isEqualTo(2);
    assertThat(state.jumpBoostUntilTick()).isEqualTo(110);
    assertThat(state.maxHealth()).isEqualTo(20);
    assertThat(state.fallDistance()).isEqualTo(4.25);
  }

  @Test
  void permanentImmunityAndAbsentEffectsRemainDistinctAndHungerBlocksSprinting() {
    var capture = new TraversalCapture(id -> Optional.empty(), InstantSource.fixed(Instant.EPOCH));
    var plain = capture.capture(player, "trooper", 100);
    assertThat(plain.maySprint()).isTrue();
    assertThat(plain.safeFallDistance()).isEqualTo(3);
    assertThat(plain.fallDamageMultiplier()).isEqualTo(1);
    assertThat(plain.noFallUntilTick()).isEqualTo(-1);
    assertThat(plain.resistanceAmplifier()).isEqualTo(-1);
    assertThat(plain.resistanceUntilTick()).isEqualTo(-1);
    player.setFoodLevel(6);
    java.util.Objects.requireNonNull(player.getAttribute(Attribute.FALL_DAMAGE_MULTIPLIER))
        .setBaseValue(0);
    var immune = capture.capture(player, "trooper", 100);
    assertThat(immune.maySprint()).isFalse();
    assertThat(immune.noFallUntilTick()).isEqualTo(Long.MAX_VALUE);
  }

  @Test
  void temporaryImmunityRoundsDownAndNeverTreatsAnExpiredEffectAsPermanent() {
    assertThat(TraversalCapture.expiry(Instant.EPOCH, Instant.EPOCH.plusMillis(49), 100))
        .isEqualTo(100);
    assertThat(TraversalCapture.expiry(Instant.EPOCH, Instant.EPOCH, 100)).isEqualTo(-1);
    assertThat(TraversalCapture.expiry(Instant.EPOCH, Instant.MAX, 100)).isEqualTo(Long.MAX_VALUE);
  }
}
