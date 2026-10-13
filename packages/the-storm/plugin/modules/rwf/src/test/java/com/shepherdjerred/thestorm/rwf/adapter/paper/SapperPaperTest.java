package com.shepherdjerred.thestorm.rwf.adapter.paper;

import static java.util.Objects.requireNonNull;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwf.KitFight;
import com.shepherdjerred.thestorm.rwf.app.KitUse;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Explosive;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Sapper;
import java.nio.file.Path;
import java.time.Duration;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.event.entity.ProjectileHitEvent;
import org.bukkit.inventory.ItemStack;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * The Sapper on MockBukkit, through the real listeners: its kit and fuse, and an Explosive's RPG
 * striking it (MockBukkit keeps launched projectiles out of the world, so the RPG is read from the
 * projectiles in flight).
 */
final class SapperPaperTest {

  @TempDir Path directory;

  /** How much health Alice, on {@code kit}, loses to an enemy Explosive's RPG striking her. */
  private double rpgHarm(String kit) {
    try (var fight = KitFight.on(directory, kit, Explosive.ID)) {
      var world = fight.harness.rwf;
      fight.alice.teleport(new Location(world, 31.5, 65, 20.5));
      fight.enemy.teleport(new Location(world, 31.5, 65, 26.5));
      var before = fight.alice.getHealth();

      var refusal =
          fight
              .harness
              .actions()
              .useKit(fight.enemyId, fight.slotOf(Explosive.ID, "EGG"), KitUse.HERE);
      assertThat(refusal).isEmpty();
      // MockBukkit does not fly projectiles: the RPG is carried to Alice and lands there.
      var runner = (MatchRunner) fight.harness.view();
      var rpg = runner.powers().projectiles().rpgsInFlight().getFirst();
      rpg.teleport(fight.alice.getLocation().clone().add(0, 1, 0));
      fight
          .harness
          .server
          .getPluginManager()
          .callEvent(new ProjectileHitEvent(rpg, null, null, null));
      fight.harness.tick(Duration.ofMillis(100));

      return before - fight.alice.getHealth();
    }
  }

  @Test
  void theSapperCarriesAnIronSwordChainmailAndAFuseThatDefusesFaster() {
    try (var fight = KitFight.on(directory, Sapper.ID)) {
      var inventory = fight.alice.getInventory();
      var fuse = requireNonNull(inventory.getItem(0));
      assertThat(
              requireNonNull(fuse.lore()).stream()
                  .map(PlainTextComponentSerializer.plainText()::serialize))
          .contains("Bomb Defusing III");
      assertThat(fuse.getItemMeta().getEnchantmentGlintOverride()).isTrue();
      assertThat(
              java.util.Arrays.stream(inventory.getContents())
                  .filter(java.util.Objects::nonNull)
                  .map(ItemStack::getType))
          .contains(Material.IRON_SWORD);
      assertThat(requireNonNull(inventory.getChestplate()).getType())
          .isEqualTo(Material.CHAINMAIL_CHESTPLATE);
    }
  }

  @Test
  void anExplosionDoesTheSapperHalfTheHarmItDoesATrooper() {
    var trooper = rpgHarm("trooper");
    var sapper = rpgHarm(Sapper.ID);

    assertThat(trooper).isPositive();
    assertThat(sapper).isPositive();
    // Chainmail stops less than the Trooper's iron, so only the halving can make it this small.
    assertThat(sapper).isLessThan(trooper * 0.75);
  }
}
