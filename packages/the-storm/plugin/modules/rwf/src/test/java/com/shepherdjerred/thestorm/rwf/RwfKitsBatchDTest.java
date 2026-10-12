package com.shepherdjerred.thestorm.rwf;

import static java.util.Objects.requireNonNull;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Inertia;
import java.nio.file.Path;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.enchantments.Enchantment;
import org.bukkit.event.player.PlayerInteractEntityEvent;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.potion.PotionEffectType;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockbukkit.mockbukkit.entity.PlayerMock;

/** Batch D kits on MockBukkit, through the real listeners: Dwarf, Sacrificial and Inertia. */
final class RwfKitsBatchDTest {

  @TempDir Path directory;
  private @Nullable KitFight fight;

  @AfterEach
  void stop() {
    if (fight != null) {
      fight.close();
    }
  }

  private KitFight on(String kit) {
    fight = KitFight.on(directory, kit);
    return fight;
  }

  /** A living bot on Alice's team, standing three blocks from her. */
  private static PlayerMock ally(KitFight fight) {
    var team = fight.harness.combatant(fight.alice).team().orElseThrow();
    for (var bot : fight.harness.bots.spawned()) {
      var id = fight.harness.bots.idOf(bot).orElseThrow();
      var view = fight.harness.snapshot().combatant(id);
      if (view.isPresent()
          && view.orElseThrow().alive()
          && view.orElseThrow().team().filter(team::equals).isPresent()) {
        bot.teleport(new Location(fight.harness.rwf, 29.5, 65, 20.5));
        return bot;
      }
    }
    throw new AssertionError("no ally bot");
  }

  @Test
  void aSneakingDwarfLevelsUpItsGearAndShowsItsLevel() {
    var fight = on("dwarf");
    fight.alice.setSneaking(true);

    fight.harness.ticks(620);

    assertThat(fight.alice.getLevel()).isEqualTo(3);
    var sword = fight.alice.getInventory().getItem(1);
    assertThat(requireNonNull(sword).getType()).isEqualTo(Material.IRON_SWORD);
    assertThat(sword.getEnchantmentLevel(Enchantment.SHARPNESS)).isEqualTo(1);
    assertThat(fight.alice.hasPotionEffect(PotionEffectType.SLOWNESS)).isFalse();
  }

  @Test
  void aBondedAllysWoundsGoToTheSacrificial() {
    var fight = on("sacrificial");
    var ally = ally(fight);
    fight.alice.getInventory().setHeldItemSlot(2);

    fight
        .harness
        .server
        .getPluginManager()
        .callEvent(new PlayerInteractEntityEvent(fight.alice, ally, EquipmentSlot.HAND));
    assertThat(RwfHarness.messages(fight.alice))
        .anyMatch(m -> m.contains("You have cast sacrifice on"));
    ally.setNoDamageTicks(0);
    ally.simulateDamage(1, fight.enemy);

    assertThat(ally.getHealth()).isEqualTo(20);
    assertThat(fight.alice.getHealth()).isLessThan(20);
  }

  @Test
  void aSacrificialHitDirectlyTakesFourTimesAsMuch() {
    var trooper = on("sacrificial");
    trooper.enemyHits();

    assertThat(20 - trooper.alice.getHealth()).isGreaterThan(4);
  }

  @Test
  void anInertiaRunsUpMomentumAndSlamsIntoAWall() {
    var fight = on("inertia");
    var world = fight.harness.rwf;
    for (var z = 0; z <= 18; z++) {
      for (var y = 65; y <= 66; y++) {
        world.getBlockAt(31, y, z).setType(Material.AIR);
      }
    }
    fight.alice.setSprinting(true);
    var at = new Location(world, 31.5, 65, 0.5, 0, 0);
    for (var step = 0; step < Inertia.MOST + 5; step++) {
      at = at.clone().add(0, 0, 0.3);
      fight.alice.teleport(at);
      fight.harness.ticks(1);
    }
    assertThat(fight.alice.getExp()).isEqualTo(1F);

    var stop = at.clone().add(0, 0, 0.3);
    world.getBlockAt(stop.clone().add(0, 0, 0.6)).setType(Material.STONE);
    world.getBlockAt(stop.clone().add(0, 1, 0.6)).setType(Material.STONE);
    fight.alice.teleport(stop);
    fight.harness.ticks(1);

    assertThat(fight.alice.getHealth()).isLessThan(20);
    assertThat(fight.alice.getExp()).isZero();
  }
}
