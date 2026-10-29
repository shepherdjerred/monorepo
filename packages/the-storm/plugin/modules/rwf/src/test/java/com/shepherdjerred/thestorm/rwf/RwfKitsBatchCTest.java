package com.shepherdjerred.thestorm.rwf;

import static java.util.Objects.requireNonNull;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import java.nio.file.Path;
import java.time.Duration;
import java.util.Locale;
import org.bukkit.Material;
import org.bukkit.entity.Arrow;
import org.bukkit.entity.Player;
import org.bukkit.event.entity.EntityShootBowEvent;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.inventory.ItemStack;
import org.bukkit.scoreboard.DisplaySlot;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * Batch C kits on MockBukkit, through the real listeners and boards: Explosive, Ghost, Wraith, Spy,
 * Skinner, and the Medic's health display that shares their per-viewer boards.
 */
final class RwfKitsBatchCTest {

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

  private void call(org.bukkit.event.Event event) {
    requireNonNull(fight).harness.server.getPluginManager().callEvent(event);
  }

  /** The team {@code seated} is shown on in {@code viewer}'s scoreboard. */
  private static String seen(Player viewer, Player seated) {
    var team = viewer.getScoreboard().getEntryTeam(seated.getName());
    return team == null ? "" : team.getName();
  }

  private static String teamName(TeamColor team) {
    return teamName(team, "");
  }

  private static String teamName(TeamColor team, String suffix) {
    return "rwf_" + team.name().toLowerCase(Locale.ROOT) + suffix;
  }

  private TeamColor teamOf(Player player) {
    var harness = requireNonNull(fight).harness;
    return harness.snapshot().combatants().stream()
        .filter(c -> c.id().uuid().equals(player.getUniqueId()))
        .findFirst()
        .orElseThrow()
        .team()
        .orElseThrow();
  }

  @Test
  void aGhostIsInvisibleAndItsNameHiddenFromTheEnemy() {
    var fight = on("ghost");

    assertThat(fight.alice.isInvisible()).isTrue();
    assertThat(seen(fight.enemy, fight.alice)).isEqualTo(teamName(teamOf(fight.alice), "_hidden"));
    assertThat(seen(fight.alice, fight.alice)).isEqualTo(teamName(teamOf(fight.alice)));
  }

  @Test
  void aWraithsArrowComesBackTwoSecondsLater() {
    var fight = on("wraith");
    fight.alice.getInventory().setHeldItemSlot(1);
    var bow = fight.alice.getInventory().getItemInMainHand();
    var arrow = fight.harness.rwf.spawn(fight.alice.getEyeLocation(), Arrow.class);

    call(
        new EntityShootBowEvent(
            fight.alice, bow, ItemStack.of(Material.ARROW), arrow, EquipmentSlot.HAND, 1, true));

    assertThat(fight.alice.getInventory().contains(Material.ARROW)).isFalse();
    fight.harness.tick(Duration.ofMillis(2050));
    assertThat(KitFight.at(fight.alice, 9)).isEqualTo(Material.ARROW);
  }

  @Test
  void aSpyWearsTheViewersOwnColours() {
    var fight = on("spy");

    // The enemy's colour, on a team apart from the enemy's own so their blows still land: the
    // first numbered team of the enemy's line, sorted among the enemy's own in the tab list.
    assertThat(seen(fight.enemy, fight.alice)).isEqualTo(teamName(teamOf(fight.enemy), "_001"));
    assertThat(seen(fight.alice, fight.alice)).isEqualTo(teamName(teamOf(fight.alice)));
  }

  @Test
  void aSkinnerWearsTheNameOfAnEnemySlainNearby() {
    var fight = on("skinner");
    fight.alice.getInventory().setHeldItemSlot(1);
    for (var i = 0; i < 40 && fight.enemyAlive(); i++) {
      fight.aliceHits();
      fight.harness.ticks(1);
    }
    assertThat(fight.enemyAlive()).isFalse();

    fight.harness.tick(Duration.ofSeconds(3));
    fight.harness.ticks(1);

    var witness = fight.anotherEnemy();
    assertThat(seen(witness, fight.alice)).isEqualTo(teamName(teamOf(fight.alice), "_hidden"));
    // The worn name itself is a per-viewer TextDisplay, which MockBukkit cannot show; the sandbox
    // check covers it.
    assertThat(seen(fight.alice, fight.alice)).isEqualTo(teamName(teamOf(fight.alice)));
  }

  @Test
  void aMedicSeesEveryonesHealthUnderTheirName() {
    var fight = on("medic");

    assertThat(fight.alice.getScoreboard().getObjective(DisplaySlot.BELOW_NAME)).isNotNull();
    assertThat(fight.enemy.getScoreboard().getObjective(DisplaySlot.BELOW_NAME)).isNull();
    fight.harness.ticks(1);
    var below = requireNonNull(fight.alice.getScoreboard().getObjective(DisplaySlot.BELOW_NAME));
    assertThat(below.getScore(fight.enemy.getName()).getScore()).isEqualTo(100);
  }
}
