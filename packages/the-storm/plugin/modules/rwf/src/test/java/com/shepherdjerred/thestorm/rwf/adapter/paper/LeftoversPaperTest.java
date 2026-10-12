package com.shepherdjerred.thestorm.rwf.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwf.KitFight;
import com.shepherdjerred.thestorm.rwf.domain.ability.AbilityEffect;
import com.shepherdjerred.thestorm.rwf.domain.ability.KitAttacks;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Vec3;
import com.shepherdjerred.thestorm.rwf.domain.kit.KitBook;
import java.nio.file.Path;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Material;
import org.bukkit.potion.PotionEffectType;
import org.bukkit.util.Vector;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * Red Warfare behaviours the first ports missed, on MockBukkit and in the adapter's pure helpers:
 * kit blasts, the spectator menu's hidden kits, team colours and the Spy's chat name.
 */
final class LeftoversPaperTest {

  @TempDir Path directory;

  @Test
  void aKitBlastSetsTheVictimsVelocityAndItsOwnersHeldSwordPoisonsThem() {
    try (var fight = KitFight.on(directory, "venom")) {
      var runner = (MatchRunner) fight.harness.view();
      var inventory = fight.alice.getInventory();
      for (var slot = 0; slot < 9; slot++) {
        var item = inventory.getItem(slot);
        if (item != null && item.getType() == Material.IRON_SWORD) {
          inventory.setHeldItemSlot(slot);
        }
      }
      fight.enemy.setVelocity(new Vector(0, -5, 0));
      var at = fight.enemy.getLocation();

      runner
          .powers()
          .apply(
              new AbilityEffect.Explode(
                  new Vec3(at.getX(), at.getY(), at.getZ()),
                  2,
                  20,
                  fight.aliceId,
                  KitAttacks.GRENADE,
                  KitAttacks.GRENADE,
                  0));

      assertThat(fight.enemy.getHealth()).isLessThan(20);
      assertThat(fight.enemy.getVelocity().getY()).isPositive();
      assertThat(fight.enemy.hasPotionEffect(PotionEffectType.POISON)).isTrue();
    }
  }

  @Test
  void theSpectatorMenuShowsTheEnemysSpyAndSacrificialAsTroopers() {
    var red = Optional.of(TeamColor.RED);
    var blue = Optional.of(TeamColor.BLUE);

    assertThat(Spectating.shownKit(Optional.of("spy"), red, blue)).isEqualTo(KitBook.TROOPER);
    assertThat(Spectating.shownKit(Optional.of("sacrificial"), red, Optional.empty()))
        .isEqualTo(KitBook.TROOPER);
    assertThat(Spectating.shownKit(Optional.of("spy"), red, red).id()).isEqualTo("spy");
    assertThat(Spectating.shownKit(Optional.of("ghost"), red, blue).id()).isEqualTo("ghost");
  }

  @Test
  void theGreenTeamIsDarkGreenAsRedWarfaresWas() {
    assertThat(Scoreboards.color(TeamColor.GREEN)).isEqualTo(NamedTextColor.DARK_GREEN);
  }

  @Test
  void aSpysChatNameTakesEachListenersTeamColour() {
    var spy = new UUID(0, 1);
    var redMate = new UUID(0, 2);
    var blue = new UUID(0, 3);
    var watcher = new UUID(0, 4);
    var view =
        new ChatNames.View(
            Map.of(spy, TeamColor.RED, redMate, TeamColor.RED, blue, TeamColor.BLUE), Set.of(spy));

    assertThat(ChatNames.color(view, spy, blue)).contains(TeamColor.BLUE);
    assertThat(ChatNames.color(view, spy, redMate)).contains(TeamColor.RED);
    assertThat(ChatNames.color(view, spy, watcher)).contains(TeamColor.RED);
    assertThat(ChatNames.color(view, blue, redMate)).contains(TeamColor.BLUE);
    assertThat(ChatNames.color(ChatNames.View.OFF, blue, redMate)).isEmpty();
  }
}
