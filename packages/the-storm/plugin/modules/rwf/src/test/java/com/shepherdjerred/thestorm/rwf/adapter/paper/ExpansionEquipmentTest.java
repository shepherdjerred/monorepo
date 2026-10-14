package com.shepherdjerred.thestorm.rwf.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwf.domain.combat.AttackType;
import com.shepherdjerred.thestorm.rwf.domain.kit.ExpansionKits;
import com.shepherdjerred.thestorm.rwf.domain.kit.KitBook;
import com.shepherdjerred.thestorm.rwf.testing.ComponentStack;
import io.papermc.paper.datacomponent.DataComponentTypes;
import java.util.List;
import java.util.Objects;
import org.bukkit.Material;
import org.bukkit.attribute.Attribute;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.PotionMeta;
import org.bukkit.potion.PotionEffect;
import org.bukkit.potion.PotionEffectType;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.entity.PlayerMock;

/** Equipment changes preserve modern cooldowns and explicit native potion durations. */
final class ExpansionEquipmentTest {
  private PlayerMock player;
  private PlayerMock victim;
  private KitFactory factory;

  @BeforeEach
  void start() {
    var server = MockBukkit.mock();
    player = server.addPlayer();
    victim = server.addPlayer();
    factory =
        KitFactory.build(
            new Keys(MockBukkit.createMockPlugin()),
            List.of(KitBook.TROOPER, ExpansionKits.MACEGUARD, ExpansionKits.FLETCHER));
  }

  @AfterEach
  void stop() {
    MockBukkit.unmock();
  }

  @Test
  void equippingAModernMeleeKitRemovesTheLegacyAttackSpeedModifier() {
    factory.equip(player, KitBook.TROOPER);
    var speed = Objects.requireNonNull(player.getAttribute(Attribute.ATTACK_SPEED));
    assertThat(speed.getModifier(Keys.ATTACK_SPEED)).isNotNull();
    factory.equip(player, ExpansionKits.MACEGUARD);
    assertThat(speed.getModifier(Keys.ATTACK_SPEED)).isNull();
    factory.equip(player, KitBook.TROOPER);
    assertThat(speed.getModifier(Keys.ATTACK_SPEED)).isNotNull();
  }

  @Test
  void authoredTippedArrowDurationIsNotShortenedByTheNativeOneEighthScale() {
    var produced = factory.kitItem(ExpansionKits.FLETCHER.hotbar().get(2));
    assertThat(produced.getData(DataComponentTypes.POTION_DURATION_SCALE)).isEqualTo(1.0f);
    // The generic fixture preserves every component through InventoryMock's clone boundary.
    player.getInventory().setItem(3, new ComponentStack(produced));
    var arrows = Objects.requireNonNull(player.getInventory().getItem(3));
    assertThat(arrows.getType()).isEqualTo(Material.TIPPED_ARROW);
    assertThat(arrows.getData(DataComponentTypes.POTION_DURATION_SCALE)).isEqualTo(1.0f);
    assertThat(((PotionMeta) arrows.getItemMeta()).getCustomEffects())
        .singleElement()
        .satisfies(
            effect -> {
              assertThat(effect.getType()).isEqualTo(PotionEffectType.SLOWNESS);
              assertThat(effect.getDuration()).isEqualTo(60);
            });
  }

  @Test
  void weaknessReducesLegacyRawDamageAndDoesNotApplyAgainToNativeRawDamage() {
    player.getInventory().setItemInMainHand(new ItemStack(Material.IRON_SWORD));
    assertThat(CombatListener.hit(AttackType.MELEE, player, victim, 0).baseDamage()).isEqualTo(6);
    player.addPotionEffect(new PotionEffect(PotionEffectType.WEAKNESS, 100, 0));
    assertThat(CombatListener.hit(AttackType.MELEE, player, victim, 0).baseDamage()).isEqualTo(2);
    player.getInventory().setItemInMainHand(new ItemStack(Material.TRIDENT));
    assertThat(CombatListener.hit(AttackType.MELEE, player, victim, 5).baseDamage()).isEqualTo(5);
  }
}
