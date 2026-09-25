package com.shepherdjerred.thestorm.spells.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.spells.domain.SpellKind;
import com.shepherdjerred.thestorm.spells.domain.cast.ReagentCost;
import com.shepherdjerred.thestorm.spells.domain.cast.ReagentPlan;
import com.shepherdjerred.thestorm.tracks.app.Track;
import java.util.Map;
import net.kyori.adventure.text.Component;
import org.bukkit.Material;
import org.bukkit.inventory.ItemStack;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

/** Reagent accounting and access on real (MockBukkit) inventories and permissions. */
final class InventoryTest {

  private static final ReagentCost COST =
      new ReagentCost(Map.of("REDSTONE", 15, "LAPIS_LAZULI", 5));

  private final Harness harness = new Harness();

  @AfterEach
  void tearDown() {
    harness.close();
  }

  @Test
  void onlyPlainStacksCountAsReagents() {
    var player = harness.server.addPlayer();
    var inventory = player.getInventory();
    inventory.setItem(0, ItemStack.of(Material.REDSTONE, 10));
    var renamed = ItemStack.of(Material.REDSTONE, 64);
    renamed.editMeta(meta -> meta.customName(Component.text("Fancy dust")));
    inventory.setItem(1, renamed);
    inventory.setItem(20, ItemStack.of(Material.REDSTONE, 8));
    inventory.setItem(21, ItemStack.of(Material.LAPIS_LAZULI, 5));
    inventory.setItem(22, ItemStack.of(Material.DIRT, 64));

    var held = ReagentPlan.held(Reagents.stacks(inventory, COST));

    assertThat(held).containsOnly(Map.entry("REDSTONE", 18), Map.entry("LAPIS_LAZULI", 5));
  }

  @Test
  void payingTakesExactlyTheCost() {
    var player = harness.server.addPlayer();
    var inventory = player.getInventory();
    inventory.setItem(3, ItemStack.of(Material.REDSTONE, 10));
    inventory.setItem(9, ItemStack.of(Material.REDSTONE, 64));
    inventory.setItem(10, ItemStack.of(Material.LAPIS_LAZULI, 5));

    Reagents.take(inventory, COST);

    assertThat(inventory.getItem(3)).isNull();
    assertThat(inventory.getItem(9)).isEqualTo(ItemStack.of(Material.REDSTONE, 59));
    assertThat(inventory.getItem(10)).isNull();
  }

  @Test
  void theSpellcasterTierIsTheHighestLevelPermission() {
    var player = harness.server.addPlayer();
    assertThat(Access.tier(player)).isZero();

    player.addAttachment(harness.plugin, Track.SPELLCASTER.permission(1), true);
    player.addAttachment(harness.plugin, Track.SPELLCASTER.permission(2), true);
    player.addAttachment(harness.plugin, Track.MECHANIC.permission(5), true);

    assertThat(Access.tier(player)).isEqualTo(2);
  }

  @Test
  void learningIsAPermissionPerSpell() {
    var player = harness.server.addPlayer();
    player.addAttachment(harness.plugin, "thestorm.spells.learned.blink", true);

    assertThat(Access.learned(player, SpellKind.BLINK)).isTrue();
    assertThat(Access.learned(player, SpellKind.CARPET)).isFalse();
  }
}
