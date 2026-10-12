package com.shepherdjerred.thestorm.rwf.domain.ability;

import static com.shepherdjerred.thestorm.rwf.testing.Samples.ALICE;
import static com.shepherdjerred.thestorm.rwf.testing.Samples.BOB;
import static com.shepherdjerred.thestorm.rwf.testing.Samples.CAROL;
import static com.shepherdjerred.thestorm.rwf.testing.Samples.DAVE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Berserker;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Juggernaut;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Vampire;
import com.shepherdjerred.thestorm.rwf.domain.combat.AttackType;
import com.shepherdjerred.thestorm.rwf.domain.combat.DamageFormula;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.kit.ItemSpec;
import com.shepherdjerred.thestorm.rwf.domain.kit.KitBook;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.SplittableRandom;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

/**
 * Batch A, the stat and effect kits: Ninja, Pyro, Venom, Juggernaut, Berserker, Equality, Vampire
 * and Bleeder, against Red Warfare's numbers.
 */
final class BatchATest {

  private static final ItemSpec IRON_SWORD = ItemSpec.of("IRON_SWORD");

  private static DamageFormula.Hit melee(ItemSpec weapon, List<ItemSpec> armor) {
    return DamageFormula.Hit.melee(weapon, armor);
  }

  private static KitCombat.Side side(String kit, KitState state) {
    return new KitCombat.Side(kit, state);
  }

  private static double damage(
      DamageFormula.Hit hit, KitCombat.Side attacker, KitCombat.Side victim) {
    return KitCombat.damage(hit, Optional.of(attacker), victim, new SplittableRandom(1));
  }

  @Nested
  final class Ninja {

    @Test
    void runsWithSpeedTwoAndNightVisionAllMatch() {
      var bout = new Bout().with(ALICE, TeamColor.RED, "ninja");

      assertThat(bout.start())
          .containsExactly(
              new AbilityEffect.Potion(ALICE, "speed", 1, AbilityEffect.FOREVER, Optional.empty()),
              new AbilityEffect.Potion(
                  ALICE, "night_vision", 0, AbilityEffect.FOREVER, Optional.empty()));
    }
  }

  @Nested
  final class Pyro {

    @Test
    void carriesOnlyItsFireGearAndNoAbility() {
      assertThat(KitBook.PYRO.ability()).isEmpty();
      assertThat(KitBook.PYRO.hotbar().getFirst().enchantmentLevel("fire_aspect")).isEqualTo(2);
      assertThat(KitBook.PYRO.hotbar().get(1).enchantmentLevel("flame")).isEqualTo(2);
      assertThat(KitBook.PYRO.armor())
          .allMatch(piece -> piece.enchantmentLevel("blast_protection") == 2);
    }
  }

  @Nested
  final class Venom {

    @Test
    void aSwordHitPoisonsAndSlowsForSixSeconds() {
      var bout =
          new Bout().with(ALICE, TeamColor.RED, "venom").with(BOB, TeamColor.BLUE, "trooper");
      bout.start();

      var effects = bout.hit(ALICE, BOB, AttackType.MELEE, "IRON_SWORD");

      assertThat(effects)
          .containsExactly(
              new AbilityEffect.PotionStack(BOB, "poison", 0, 120, Optional.of(ALICE)),
              new AbilityEffect.PotionStack(BOB, "slowness", 0, 120, Optional.of(ALICE)));
    }

    @Test
    void onlyTheHeldSwordMattersNotHowTheHitLanded() {
      var bout =
          new Bout().with(ALICE, TeamColor.RED, "venom").with(BOB, TeamColor.BLUE, "trooper");
      bout.start();

      assertThat(bout.hit(ALICE, BOB, AttackType.MELEE, "COMPASS")).isEmpty();
      assertThat(bout.hit(ALICE, BOB, AttackType.PROJECTILE, "IRON_SWORD")).hasSize(2);
    }
  }

  @Nested
  final class JuggernautKit {

    @Test
    void hasFifteenHeartsAndCannotSprint() {
      var bout = new Bout().with(ALICE, TeamColor.RED, "juggernaut");

      assertThat(bout.start()).containsExactly(new AbilityEffect.MaxHealth(ALICE, 30, true));
      assertThat(KitCombat.maySprint("juggernaut")).isFalse();
      assertThat(KitCombat.maySprint("trooper")).isTrue();
      assertThat(KitCombat.knockback("juggernaut")).isEqualTo(Juggernaut.KNOCKBACK);
    }

    @Test
    void takesSixtyPercentOfHitsAndThreeQuartersOfExplosionsButAllOfTheWorld() {
      var plain = DamageFormula.finalDamage(melee(IRON_SWORD, List.of()));

      assertThat(
              damage(
                  melee(IRON_SWORD, List.of()),
                  side("trooper", KitState.NONE),
                  side("juggernaut", KitState.NONE)))
          .isCloseTo(plain * 0.6, within(1e-9));
      var blast = DamageFormula.Hit.of(AttackType.EXPLOSION, 10, List.of());
      assertThat(damage(blast, side("trooper", KitState.NONE), side("juggernaut", KitState.NONE)))
          .isCloseTo(7.5, within(1e-9));
      var fall = DamageFormula.Hit.of(AttackType.FALL, 10, List.of());
      assertThat(
              KitCombat.damage(
                  fall,
                  Optional.empty(),
                  new KitCombat.Side("juggernaut", KitState.NONE),
                  new SplittableRandom(1)))
          .as("no attacker, no reduction")
          .isEqualTo(10);
      var poison = DamageFormula.Hit.of(AttackType.POISON, 2, List.of());
      assertThat(damage(poison, side("venom", KitState.NONE), side("juggernaut", KitState.NONE)))
          .as("damage that ignores armor is not reduced")
          .isEqualTo(2);
    }
  }

  @Nested
  final class BerserkerKit {

    @Test
    void eachWholeKillAddsSevenTenthsUpToSeven() {
      var bout =
          new Bout()
              .with(ALICE, TeamColor.RED, "berserker")
              .with(BOB, TeamColor.BLUE, "trooper")
              .with(CAROL, TeamColor.BLUE, "trooper");
      bout.start();

      bout.kill(BOB, ALICE);
      assertThat(bout.state(ALICE, Berserker.State.class).bonus()).isCloseTo(0.7, within(1e-9));
      bout.die(CAROL, Optional.of(BOB), Map.of(ALICE, 0.5));
      assertThat(bout.state(ALICE, Berserker.State.class).streak()).isEqualTo(1.5);
      assertThat(bout.state(ALICE, Berserker.State.class).kills())
          .as("assists count only once they add up to a whole kill")
          .isEqualTo(1);
      assertThat(new Berserker.State(25).bonus()).isEqualTo(7);
    }

    @Test
    void evenASmallShareCountsTowardTheStreak() {
      var bout =
          new Bout().with(ALICE, TeamColor.RED, "berserker").with(BOB, TeamColor.BLUE, "trooper");
      bout.start();

      bout.die(BOB, Optional.empty(), Map.of(ALICE, 0.05));

      assertThat(bout.state(ALICE, Berserker.State.class).streak()).isEqualTo(0.05);
    }

    @Test
    void theBloodlustAddsBeforeArmor() {
      var armor = KitBook.TROOPER.armor();
      var hit = melee(ItemSpec.of("IRON_AXE").enchanted("sharpness", 2), armor);

      var calm =
          damage(hit, side("berserker", new Berserker.State(0)), side("trooper", KitState.NONE));
      var bloodied =
          damage(hit, side("berserker", new Berserker.State(3)), side("trooper", KitState.NONE));

      assertThat(bloodied - calm).isCloseTo(2.1 * (1 - 15 / 25.0), within(1e-9));
    }
  }

  @Nested
  final class EqualityKit {

    @Test
    void dealsAndTakesExactlyThreeFromSwordsAndArrows() {
      var heavy = melee(ItemSpec.of("DIAMOND_SWORD").enchanted("sharpness", 5), List.of());
      var arrow = DamageFormula.Hit.of(AttackType.PROJECTILE, 9, List.of());

      assertThat(damage(heavy, side("equality", KitState.NONE), side("juggernaut", KitState.NONE)))
          .isEqualTo(3);
      assertThat(damage(arrow, side("shortbow", KitState.NONE), side("equality", KitState.NONE)))
          .isEqualTo(3);
      var fall = DamageFormula.Hit.of(AttackType.FALL, 9, List.of());
      assertThat(
              KitCombat.damage(
                  fall,
                  Optional.empty(),
                  new KitCombat.Side("equality", KitState.NONE),
                  new SplittableRandom(1)))
          .isEqualTo(9);
    }
  }

  @Nested
  final class VampireKit {

    @Test
    void startsAtEightHeartsAndGrowsAHeartAKillUpToTwenty() {
      var bout =
          new Bout()
              .with(ALICE, TeamColor.RED, "vampire")
              .with(BOB, TeamColor.BLUE, "trooper")
              .with(CAROL, TeamColor.BLUE, "trooper");

      assertThat(bout.start()).containsExactly(new AbilityEffect.MaxHealth(ALICE, 16, false));
      var effects = bout.kill(BOB, ALICE);

      assertThat(effects)
          .contains(
              new AbilityEffect.MaxHealth(ALICE, 18, false),
              new AbilityEffect.Potion(ALICE, "regeneration", 0, 300, Optional.empty()));
      assertThat(bout.state(ALICE, Vampire.State.class).maxHealth()).isEqualTo(18);

      // Red Warfare rewarded an assist only when it lifted the floored killstreak.
      bout.with(DAVE, TeamColor.BLUE, "trooper");
      assertThat(bout.die(CAROL, Optional.of(BOB), Map.of(ALICE, 0.4))).isEmpty();
      var assist = bout.die(DAVE, Optional.of(BOB), Map.of(ALICE, 0.7));
      assertThat(assist)
          .contains(
              new AbilityEffect.MaxHealth(ALICE, 19, false),
              new AbilityEffect.Potion(ALICE, "regeneration", 0, 150, Optional.empty()),
              new AbilityEffect.Say(
                  List.of(ALICE),
                  "§7You gained §a0 Heart§7 for assisting §e"
                      + bout.name(BOB)
                      + " in killing §e"
                      + bout.name(DAVE),
                  AbilityEffect.Tone.LEGACY));
    }

    @Test
    void stopsGrowingAtTwentyHearts() {
      var bout =
          new Bout().with(ALICE, TeamColor.RED, "vampire").with(BOB, TeamColor.BLUE, "trooper");
      bout.start();
      bout.abilities =
          new Abilities(
              Map.of(ALICE, new Vampire.State(39.5, 0)),
              Map.of(),
              Map.of(),
              Map.of(),
              List.of(),
              2,
              22);

      assertThat(bout.kill(BOB, ALICE)).contains(new AbilityEffect.MaxHealth(ALICE, 40, false));
      assertThat(bout.state(ALICE, Vampire.State.class).maxHealth()).isEqualTo(40);
    }
  }

  @Nested
  final class BleederKit {

    @Test
    void dealsTwoToThreeInPlaceOfItsWeapon() {
      var random = new SplittableRandom(3);
      var hit = melee(ItemSpec.of("WOODEN_SWORD"), List.of());
      for (var i = 0; i < 50; i++) {
        var dealt =
            KitCombat.damage(
                hit,
                Optional.of(new KitCombat.Side("bleeder", KitState.NONE)),
                new KitCombat.Side("trooper", KitState.NONE),
                random);
        assertThat(dealt).isBetween(2.0, 3.0);
      }
    }

    @Test
    void everyHitTakesThatMuchMaxHealthForGoodDownToHalfAHeart() {
      var bout =
          new Bout().with(ALICE, TeamColor.RED, "bleeder").with(BOB, TeamColor.BLUE, "trooper");
      bout.start();

      assertThat(
              bout.act(
                  ALICE,
                  new AbilityInput.Hit(
                      BOB, AttackType.MELEE, Optional.of("WOODEN_SWORD"), 2.5, 15, 20)))
          .contains(new AbilityEffect.MaxHealth(BOB, 17.5, false));
      assertThat(
              bout.act(
                  ALICE,
                  new AbilityInput.Hit(
                      BOB, AttackType.MELEE, Optional.of("WOODEN_SWORD"), 2, 0.5, 1)))
          .contains(new AbilityEffect.MaxHealth(BOB, 0.5, false));
      assertThat(
              bout.act(
                  ALICE,
                  new AbilityInput.Hit(
                      BOB, AttackType.MELEE, Optional.of("WOODEN_SWORD"), 3, 0, 20)))
          .as("a killing blow leaves nothing to bleed")
          .isEmpty();
    }
  }
}
