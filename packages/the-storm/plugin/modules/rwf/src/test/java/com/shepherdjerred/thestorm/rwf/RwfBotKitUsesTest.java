package com.shepherdjerred.thestorm.rwf;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwf.app.ActionRefusal;
import com.shepherdjerred.thestorm.rwf.app.KitUse;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Teleporter;
import java.nio.file.Path;
import java.util.Optional;
import org.bukkit.Location;
import org.bukkit.Material;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * Kit items used through {@code CombatantActions.useKit}, as bots use them: each becomes the input
 * a player's click does, and what cannot be used is refused.
 */
final class RwfBotKitUsesTest {

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

  @Test
  void anRpgFliesFromTheSlotItSits() {
    var fight = on("explosive");

    var refusal = fight.harness.actions().useKit(fight.aliceId, 2, KitUse.HERE);

    assertThat(refusal).isEmpty();
    assertThat(fight.alice.getInventory().contains(org.bukkit.Material.EGG, 5))
        .as("one RPG left the launcher")
        .isFalse();
    assertThat(fight.alice.getInventory().getHeldItemSlot()).isEqualTo(2);
  }

  @Test
  void aLandmineGoesDownAtTheFeet() {
    var fight = on("demolitions");
    var world = fight.harness.rwf;
    world.getBlockAt(31, 64, 25).setType(Material.STONE);
    world.getBlockAt(31, 65, 25).setType(Material.AIR);
    fight.alice.teleport(new Location(world, 31.5, 65, 25.5));

    assertThat(fight.harness.actions().useKit(fight.aliceId, 2, KitUse.HERE)).isEmpty();

    assertThat(world.getBlockAt(31, 65, 25).getType()).isEqualTo(Material.STONE_PRESSURE_PLATE);
  }

  @Test
  void aWarpersWandNeedsAnEnemyInReach() {
    var fight = on("warper");
    fight.enemy.teleport(fight.alice.getLocation().clone().add(30, 0, 0));

    assertThat(
            fight
                .harness
                .actions()
                .useKit(fight.aliceId, 2, new KitUse(Optional.of(fight.enemyId), Optional.empty())))
        .contains(ActionRefusal.OUT_OF_REACH);
  }

  @Test
  void aSacrificialBondsTheAllyItTouches() {
    var fight = on("sacrificial");
    var ally = fight.ally(32.5, 20.5);
    var allyId = fight.botId(ally);

    var refusal =
        fight
            .harness
            .actions()
            .useKit(
                fight.aliceId,
                fight.slotOf("sacrificial", "RED_DYE"),
                new KitUse(Optional.of(allyId), Optional.empty()));

    assertThat(refusal).isEmpty();
    assertThat(RwfHarness.messages(fight.alice))
        .anyMatch(m -> m.contains("You have cast sacrifice on"));
    ally.setNoDamageTicks(0);
    ally.simulateDamage(1, fight.enemy);
    assertThat(ally.getHealth()).isEqualTo(20);
    assertThat(fight.alice.getHealth()).isLessThan(20);
  }

  @Test
  void aTeleportersRemotePutsAPadUnderATeammate() {
    var fight = on("teleporter");
    var ally = fight.ally(31.5, 40.5);
    var allyId = fight.botId(ally);

    var refusal =
        fight
            .harness
            .actions()
            .useKit(
                fight.aliceId,
                fight.slotOf("teleporter", "MAP"),
                new KitUse(Optional.of(allyId), Optional.empty()));

    assertThat(refusal).isEmpty();
    assertThat(fight.harness.rwf.getBlockAt(31, 64, 40).getType())
        .isEqualTo(Material.matchMaterial(Teleporter.BLOCK));
  }

  @Test
  void aSlotWithoutAKitItemIsRefused() {
    var fight = on("trooper");

    assertThat(fight.harness.actions().useKit(fight.aliceId, 8, KitUse.HERE))
        .contains(ActionRefusal.NO_KIT_ITEM);
    assertThat(fight.harness.actions().useKit(fight.aliceId, 1, KitUse.HERE))
        .contains(ActionRefusal.NO_KIT_ITEM);
  }
}
