package com.shepherdjerred.thestorm.rwfbots.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.app.Loadouts;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import java.util.Optional;
import org.bukkit.Material;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.CrossbowMeta;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.entity.PlayerMock;

/** Native ammunition availability controls ranged decisions without changing the kit template. */
final class PaperLoadoutsTest {
  private PlayerMock player;

  @BeforeEach
  void start() {
    player = MockBukkit.mock().addPlayer();
  }

  @AfterEach
  void stop() {
    MockBukkit.unmock();
  }

  @Test
  void runningOutOfFiniteArrowsDisablesRangedCombatUntilAmmunitionReturns() {
    var kit = Loadouts.rwf(Kit.LONGBOW);
    player.getInventory().setItem(kit.bowSlot(), new ItemStack(Material.BOW));
    assertThat(PaperLoadouts.available(kit, Optional.of(player)).hasBow()).isFalse();

    player.getInventory().setItem(8, new ItemStack(Material.TIPPED_ARROW));
    assertThat(PaperLoadouts.available(kit, Optional.of(player))).isEqualTo(kit);
    player.getInventory().setItem(8, null);

    assertThat(PaperLoadouts.available(kit, Optional.of(player)).hasBow()).isFalse();
    assertThat(kit.hasBow()).isTrue();
  }

  @Test
  void aLoadedCrossbowCanFireItsLastArrowWithoutSpareAmmunition() {
    var kit = Loadouts.rwf(Kit.TRACKER);
    var crossbow = new ItemStack(Material.CROSSBOW);
    crossbow.editMeta(
        CrossbowMeta.class,
        meta -> meta.addChargedProjectile(new ItemStack(Material.SPECTRAL_ARROW)));
    player.getInventory().setItem(kit.bowSlot(), crossbow);

    assertThat(PaperLoadouts.available(kit, Optional.of(player))).isEqualTo(kit);
    player.getInventory().setItem(kit.bowSlot(), new ItemStack(Material.CROSSBOW));
    assertThat(PaperLoadouts.available(kit, Optional.of(player)).hasBow()).isFalse();
  }

  @Test
  void anAbsentBodyCannotAttemptToDrawAWeapon() {
    var kit = Loadouts.rwf(Kit.LONGBOW);
    assertThat(PaperLoadouts.available(kit, Optional.empty()).hasBow()).isFalse();
  }

  @Test
  void theSteakSlotFollowsTheSteaksTheBodyCarries() {
    var berserker = Loadouts.rwf(Kit.BERSERKER);
    var slot = berserker.steakSlot();
    player.getInventory().setItem(slot, new ItemStack(Material.COOKED_BEEF, 2));
    assertThat(PaperLoadouts.available(berserker, Optional.of(player)).steakSlot()).isEqualTo(slot);

    player.getInventory().setItem(slot, null);
    assertThat(PaperLoadouts.available(berserker, Optional.of(player)).hasSteak()).isFalse();
    assertThat(PaperLoadouts.available(berserker, Optional.empty()).hasSteak()).isFalse();

    // A supply crate's steak lands wherever there is room, for any kit.
    var trooper = Loadouts.rwf(Kit.TROOPER);
    player.getInventory().setItem(6, new ItemStack(Material.COOKED_BEEF));
    assertThat(PaperLoadouts.available(trooper, Optional.of(player)).steakSlot()).isEqualTo(6);
    // Off the hotbar, the consume port cannot reach it.
    player.getInventory().setItem(6, null);
    player.getInventory().setItem(20, new ItemStack(Material.COOKED_BEEF));
    assertThat(PaperLoadouts.available(trooper, Optional.of(player)).hasSteak()).isFalse();
  }
}
