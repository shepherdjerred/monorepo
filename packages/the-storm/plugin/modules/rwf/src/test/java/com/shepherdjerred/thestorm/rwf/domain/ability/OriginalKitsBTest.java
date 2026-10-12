package com.shepherdjerred.thestorm.rwf.domain.ability;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Demolitions;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Dwarf;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Explosive;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Ghost;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Sacrificial;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Skinner;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Teleporter;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Wraith;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.kit.ItemSpec;
import com.shepherdjerred.thestorm.rwf.domain.kit.KitBook;
import com.shepherdjerred.thestorm.rwf.testing.Samples;
import java.time.Duration;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * Pins the Teleporter, Demolitions, Explosive, Ghost, Wraith, Spy, Skinner, Dwarf and Sacrificial
 * to the numbers, names and words of libraryaddict's Red Warfare ({@code kits/} and {@code
 * abilities/}), so a change that drifts from the original fails here first.
 */
final class OriginalKitsBTest {

  @Test
  void dwarfAbilityConstants() {
    assertThat(Dwarf.SNEAK_GAIN).isEqualTo(0.005F);
    assertThat(Dwarf.IDLE_LOSS).isEqualTo(0.005F);
    assertThat(Dwarf.SPRINT_LOSS).isEqualTo(0.02F);
    assertThat(Dwarf.LOSS_PER_LEVEL).isEqualTo(0.02);
    assertThat(Dwarf.MOST).isEqualTo(48);
    assertThat(Dwarf.UNSLOWED).isEqualTo(5);
    assertThat(Dwarf.SLOWNESS_TICKS).isEqualTo(999_999);
    assertThat(List.of(Dwarf.sharpness(15), Dwarf.sharpness(18), Dwarf.sharpness(21)))
        .containsExactly(5, 5, 5);
    assertThat(List.of(Dwarf.protection(36), Dwarf.protection(42))).containsExactly(6, 6);
    assertThat(Dwarf.blast(48)).isEqualTo(6);
  }

  @Test
  void demolitionsAbilityConstants() {
    assertThat(Demolitions.ARMING).isEqualTo(Duration.ofSeconds(2));
    assertThat(Demolitions.SETTLE).isEqualTo(Duration.ofMillis(100));
    assertThat(Demolitions.FUSE).isEqualTo(Duration.ofMillis(700));
    assertThat(Demolitions.RESTOCK).isEqualTo(Duration.ofSeconds(40));
    assertThat(Demolitions.POWER).isEqualTo(6F);
    assertThat(Demolitions.MOST_DAMAGE).isEqualTo(30);
    assertThat(Demolitions.PLATE).isEqualTo("STONE_PRESSURE_PLATE");
  }

  @Test
  void explosiveAbilityConstants() {
    assertThat(Explosive.RPG_RECHARGE).isEqualTo(Duration.ofSeconds(30));
    assertThat(Explosive.RPG_POWER).isEqualTo(6.5F);
    assertThat(Explosive.RPG_MOST).isEqualTo(20);
    assertThat(Explosive.SELF_EXTRA).isEqualTo(4);
    assertThat(Explosive.CHARGES).isEqualTo(5);
    assertThat(Explosive.CHARGE).isEqualTo(Duration.ofSeconds(5));
    assertThat(Explosive.FUSE).isEqualTo(Duration.ofSeconds(3));
    assertThat(Explosive.GRENADE_POWER).isEqualTo(5.5F);
    assertThat(Explosive.GRENADE_MOST).isEqualTo(16);
    assertThat(Explosive.FIRST_RESTOCK).isEqualTo(Duration.ofSeconds(8));
    assertThat(Explosive.RESTOCK_EVERY).isEqualTo(Duration.ofSeconds(13));
    assertThat(Explosive.MOST_GRENADES).isEqualTo(20);
  }

  @Test
  void ghostWraithSkinnerAndSacrificialConstants() {
    assertThat(Ghost.STUCK).isEqualTo(Duration.ofSeconds(10));
    assertThat(Wraith.RELOAD).isEqualTo(Duration.ofSeconds(2));
    assertThat(Skinner.REACH).isEqualTo(7);
    assertThat(Skinner.DRESSING).isEqualTo(Duration.ofSeconds(3));
    assertThat(Skinner.CLOCK).isEqualTo(Duration.ofMillis(500));
    assertThat(Sacrificial.DIRECT).isEqualTo(4);
    assertThat(Sacrificial.STEAK).isEqualTo(Duration.ofSeconds(20));
    assertThat(Sacrificial.STEAKS_ALONE).isEqualTo(5);
    assertThat(Sacrificial.STEAKS_BONDED).isEqualTo(20);
    assertThat(Sacrificial.SNIPS).isEqualTo(2);
    assertThat(Sacrificial.UNBONDABLE).containsExactlyInAnyOrder("sacrificial", "dwarf");
  }

  @Test
  void teleporterConstants() {
    assertThat(Teleporter.BLOCK).isEqualTo("INFESTED_CHISELED_STONE_BRICKS");
    assertThat(Teleporter.MOST).isEqualTo(2);
    assertThat(Teleporter.USE).isEqualTo(Duration.ofSeconds(2));
    assertThat(Teleporter.UNSTABLE).isEqualTo(Duration.ofSeconds(8));
    assertThat(Teleporter.LANDING).isEqualTo(1.2);
    assertThat(Teleporter.recharge(10)).isEqualTo(Duration.ofSeconds(5));
    assertThat(Teleporter.recharge(1000)).isEqualTo(Duration.ofSeconds(90));
  }

  @Test
  void kitsCarryTheOriginalItemsPricesAndWords() {
    assertThat(KitBook.DWARF.price()).isEqualTo(500);
    assertThat(KitBook.DEMOLITIONS.price()).isEqualTo(300);
    assertThat(KitBook.EXPLOSIVE.price()).isEqualTo(150);
    assertThat(KitBook.GHOST.price()).isEqualTo(150);
    assertThat(KitBook.WRAITH.price()).isEqualTo(200);
    assertThat(KitBook.SPY.price()).isEqualTo(250);
    assertThat(KitBook.SKINNER.price()).isEqualTo(300);
    assertThat(KitBook.SACRIFICIAL.price()).isEqualTo(500);
    assertThat(KitBook.TELEPORTER.price()).isZero();

    assertThat(KitBook.SPY.description())
        .isEqualTo(
            "A sneaky kit that always looks like the team of the view. He looks like a trooper!");
    assertThat(KitBook.SACRIFICIAL.description())
        .startsWith("This kit will lets the user sacrifice")
        .contains("their every replenishing steak");
    assertThat(KitBook.WRAITH.description().split("\n", -1)).hasSize(3);
    assertThat(KitBook.SKINNER.description().split("\n", -1))
        .containsExactly(
            "A stealth fighter kit which gains the nametag and nametag color of any enemy slain"
                + " nearby.",
            "Much like an adaptive Spy.",
            "Every kill they are defenseless for 3 seconds.");

    var shears = KitBook.SACRIFICIAL.hotbar().get(3);
    assertThat(shears.material()).isEqualTo("SHEARS");
    assertThat(shears.amount()).as("two shears in one slot").isEqualTo(2);
    assertThat(shears.name()).contains("Destroy Sacrificial Bonds");
    assertThat(KitBook.SACRIFICIAL.hotbar().get(1).name()).contains("Sacrificial Magic");

    assertThat(KitBook.DEMOLITIONS.hotbar())
        .extracting(ItemSpec::material)
        .containsExactly("IRON_SWORD", "STONE_PRESSURE_PLATE");
    assertThat(KitBook.DEMOLITIONS.hotbar().get(1).amount()).isEqualTo(2);
    assertThat(KitBook.EXPLOSIVE.hotbar())
        .extracting(ItemSpec::material, ItemSpec::amount)
        .containsExactly(
            org.assertj.core.groups.Tuple.tuple("STONE_SWORD", 1),
            org.assertj.core.groups.Tuple.tuple("EGG", 5),
            org.assertj.core.groups.Tuple.tuple("FIREWORK_STAR", 10));
    assertThat(KitBook.GHOST.hotbar())
        .extracting(ItemSpec::material)
        .containsExactly("GOLDEN_SWORD", ItemSpec.GAP, "ENDER_PEARL");
    assertThat(KitBook.GHOST.armor()).isEmpty();
    assertThat(KitBook.WRAITH.armor()).isEmpty();
    assertThat(KitBook.TELEPORTER.hotbar())
        .extracting(ItemSpec::material)
        .containsExactly("IRON_SWORD", "QUARTZ", "MAP");
  }

  @Test
  void messagesKeepTheOriginalColours() {
    assertThat(KitText.team(TeamColor.GREEN)).isEqualTo("§2");
    assertThat(KitText.team(TeamColor.PURPLE)).isEqualTo("§5");
    assertThat(KitText.team(TeamColor.YELLOW)).isEqualTo("§e");
    var bout =
        new Bout()
            .with(Samples.ALICE, TeamColor.RED, "ghost")
            .with(Samples.BOB, TeamColor.BLUE, "longbow");
    bout.start();

    assertThat(
            bout.hit(
                Samples.BOB,
                Samples.ALICE,
                com.shepherdjerred.thestorm.rwf.domain.combat.AttackType.PROJECTILE,
                "BOW"))
        .contains(
            new AbilityEffect.Say(
                List.of(Samples.ALICE),
                "§b§ksd§bYou were slammed with a arrow!",
                AbilityEffect.Tone.INFO));
  }
}
