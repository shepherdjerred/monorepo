package com.shepherdjerred.thestorm.rwf.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwf.KitFight;
import java.nio.file.Path;
import java.util.Random;
import org.bukkit.Material;
import org.bukkit.block.BlockFace;
import org.bukkit.event.block.Action;
import org.bukkit.event.entity.ProjectileHitEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.inventory.EquipmentSlot;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/**
 * The Explosive's RPG on MockBukkit: an arrow launched from the firer (MockBukkit keeps launched
 * projectiles out of the world, so the arrow is read from the projectiles in flight) that explodes
 * where it lands.
 */
final class KitProjectilesPaperTest {

  @TempDir Path directory;
  private @Nullable KitFight fight;

  @AfterEach
  void stop() {
    if (fight != null) {
      fight.close();
    }
  }

  @ParameterizedTest
  @ValueSource(booleans = {false, true})
  void anExplosivesRpgIsAnArrowThatExplodesWhereItLands(boolean hitsFighter) {
    var fight = KitFight.on(directory, "explosive");
    this.fight = fight;
    fight.alice.getInventory().setHeldItemSlot(2);

    fight
        .harness
        .server
        .getPluginManager()
        .callEvent(
            new PlayerInteractEvent(
                fight.alice,
                Action.RIGHT_CLICK_AIR,
                fight.alice.getInventory().getItemInMainHand(),
                null,
                BlockFace.SELF,
                EquipmentSlot.HAND));

    var runner = (MatchRunner) fight.harness.view();
    var rpgs = runner.powers().projectiles().rpgsInFlight();
    assertThat(rpgs).hasSize(1);
    assertThat(fight.alice.getInventory().contains(Material.EGG, 5)).isFalse();
    var rpg = rpgs.getFirst();
    rpg.teleport(fight.enemy.getLocation().clone().add(0, 0.5, 0));
    if (hitsFighter) {
      assertThat(fight.enemy.simulateDamage(1, rpg).isCancelled()).isTrue();
    } else {
      fight
          .harness
          .server
          .getPluginManager()
          .callEvent(new ProjectileHitEvent(rpg, null, null, null));
    }

    assertThat(fight.enemy.getHealth()).isLessThan(20);
    assertThat(runner.powers().projectiles().rpgsInFlight()).isEmpty();
  }

  @Test
  void theSameSeedReplaysSuccessiveRpgSpreads() {
    var fight = KitFight.on(directory, "explosive");
    this.fight = fight;
    var recorded = new Random(413);
    var replayed = new Random(413);
    var otherMatch = new Random(414);
    var previous = KitProjectiles.eggVelocity(fight.alice, recorded);

    assertThat(KitProjectiles.eggVelocity(fight.alice, replayed)).isEqualTo(previous);
    assertThat(KitProjectiles.eggVelocity(fight.alice, otherMatch)).isNotEqualTo(previous);
    for (var shot = 0; shot < 4; shot++) {
      var next = KitProjectiles.eggVelocity(fight.alice, recorded);
      assertThat(KitProjectiles.eggVelocity(fight.alice, replayed)).isEqualTo(next);
      assertThat(next).isNotEqualTo(previous);
      previous = next;
    }
  }
}
