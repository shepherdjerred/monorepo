package com.shepherdjerred.thestorm.rwf.domain.combat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import com.shepherdjerred.thestorm.rwf.domain.combat.HitWindow.Guard;
import com.shepherdjerred.thestorm.rwf.domain.combat.HitWindow.Resolution;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Vec3;
import com.shepherdjerred.thestorm.rwf.domain.kit.ArmorSlot;
import com.shepherdjerred.thestorm.rwf.domain.kit.ItemSpec;
import com.shepherdjerred.thestorm.rwf.domain.kit.KitBook;
import java.util.List;
import java.util.SplittableRandom;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

/** Golden values for the ported combat formulas. */
final class CombatTest {

  private static final List<ItemSpec> FULL_IRON = KitBook.TROOPER.armor();
  private static final List<ItemSpec> REWIND_ARMOR = KitBook.REWIND.armor();

  @Nested
  final class Weapons {

    @Test
    void swordsDealTierPlusFourAndOtherToolsLess() {
      assertThat(WeaponDamage.of("IRON_SWORD")).isEqualTo(6);
      assertThat(WeaponDamage.of("DIAMOND_SWORD")).isEqualTo(7);
      assertThat(WeaponDamage.of("STONE_SWORD")).isEqualTo(5);
      assertThat(WeaponDamage.of("GOLDEN_SWORD")).isEqualTo(4.5);
      assertThat(WeaponDamage.of("WOODEN_SWORD")).isEqualTo(4);
      assertThat(WeaponDamage.of("IRON_AXE")).isEqualTo(5);
      assertThat(WeaponDamage.of("DIAMOND_PICKAXE")).isEqualTo(5);
      assertThat(WeaponDamage.of("IRON_SHOVEL")).isEqualTo(3);
    }

    @Test
    void anythingElseDealsOne() {
      assertThat(WeaponDamage.of("BLAZE_POWDER")).isEqualTo(1);
      assertThat(WeaponDamage.of("AIR")).isEqualTo(1);
      assertThat(WeaponDamage.of("BOW")).isEqualTo(1);
    }
  }

  @Nested
  final class Armor {

    @Test
    void defencePointsFollowTheOldTable() {
      assertThat(ArmorRating.rating(FULL_IRON)).isEqualTo(15);
      assertThat(ArmorRating.rating(KitBook.LONGBOW.armor())).isEqualTo(14);
      assertThat(ArmorRating.rating(REWIND_ARMOR)).isEqualTo(15);
      assertThat(ArmorRating.defence("DIAMOND_CHESTPLATE")).isEqualTo(8);
      assertThat(ArmorRating.defence("LEATHER_BOOTS")).isEqualTo(1);
      assertThat(ArmorRating.defence("GOLDEN_HELMET")).isEqualTo(2);
      assertThat(ArmorRating.defence("IRON_SWORD")).isZero();
      assertThat(ArmorRating.defence("BOW")).isZero();
    }

    @Test
    void protectionIsScaledByTheKindOfDamageAndCapped() {
      assertThat(ArmorRating.protection(REWIND_ARMOR, AttackType.MELEE)).isEqualTo(1.75F);
      assertThat(ArmorRating.protection(REWIND_ARMOR, AttackType.END_OF_GAME)).isZero();
      var fireproof =
          List.of(
              ItemSpec.armor("LEATHER_CHESTPLATE", ArmorSlot.CHESTPLATE)
                  .enchanted("fire_protection", 1));
      assertThat(ArmorRating.protection(fireproof, AttackType.FIRE_TICK))
          .isCloseTo(7 / 3F * 1.25F, within(1e-6F));
      var stacked =
          List.of(
              ItemSpec.armor("DIAMOND_CHESTPLATE", ArmorSlot.CHESTPLATE)
                  .enchanted("protection", 10));
      assertThat(ArmorRating.protection(stacked, AttackType.MELEE)).isEqualTo(20);
    }
  }

  @Nested
  final class Damage {

    @Test
    void aTrooperSwordAgainstFullIron() {
      var hit = DamageFormula.Hit.melee(KitBook.TROOPER.hotbar().getFirst(), FULL_IRON);

      assertThat(DamageFormula.finalDamage(hit)).isCloseTo(2.9, within(1e-9));
    }

    @Test
    void protectionTakesItsShareAfterArmor() {
      var hit = DamageFormula.Hit.melee(KitBook.TROOPER.hotbar().getFirst(), REWIND_ARMOR);

      assertThat(DamageFormula.finalDamage(hit)).isCloseTo(2.697, within(1e-9));
    }

    @Test
    void armorIgnoringDamageGoesStraightThrough() {
      var hit = DamageFormula.Hit.of(AttackType.END_OF_GAME, 5, FULL_IRON);

      assertThat(DamageFormula.finalDamage(hit)).isEqualTo(5);
    }

    @Test
    void fireProtectionStillCountsAgainstBurnsThatIgnoreArmor() {
      var fireproof =
          List.of(
              ItemSpec.armor("LEATHER_CHESTPLATE", ArmorSlot.CHESTPLATE)
                  .enchanted("fire_protection", 1));
      var hit = DamageFormula.Hit.of(AttackType.FIRE_TICK, 1, fireproof);

      assertThat(DamageFormula.finalDamage(hit)).isCloseTo(1 - (7 / 3.0 * 1.25) / 25, within(1e-6));
    }

    @Test
    void anArrowAgainstRewindArmor() {
      var hit = DamageFormula.Hit.of(AttackType.PROJECTILE, 6, REWIND_ARMOR);

      assertThat(DamageFormula.finalDamage(hit)).isCloseTo(2.232, within(1e-9));
    }

    @Test
    void aMultiplierScalesTheResult() {
      var hit =
          new DamageFormula.Hit(AttackType.MELEE, 10, java.util.Optional.empty(), List.of(), 0.6);

      assertThat(DamageFormula.finalDamage(hit)).isCloseTo(6, within(1e-9));
    }
  }

  @Nested
  final class Window {

    @Test
    void insideTheWindowOnlyTheExtraLands() {
      var guard = new Guard(15, 4);

      assertThat(HitWindow.resolve(4, AttackType.MELEE, guard)).isEqualTo(new Resolution.Blocked());
      assertThat(HitWindow.resolve(4.0005, AttackType.MELEE, guard))
          .isEqualTo(new Resolution.Blocked());
      assertThat(HitWindow.resolve(6, AttackType.MELEE, guard))
          .isEqualTo(new Resolution.Partial(2));
    }

    @Test
    void outsideTheWindowOrForInstantDeathsEverythingLands() {
      assertThat(HitWindow.resolve(3, AttackType.MELEE, new Guard(10, 4)))
          .isEqualTo(new Resolution.Full(3));
      assertThat(HitWindow.resolve(0, AttackType.BOMB_EXPLODE, new Guard(20, 9)))
          .isEqualTo(new Resolution.Full(0));
      assertThat(HitWindow.resolve(2, AttackType.FALL, new Guard(20, 9)))
          .isEqualTo(new Resolution.Full(2));
    }

    @Test
    void anAttackerMustWaitHalfTheWindowAndHitHarder() {
      assertThat(HitWindow.canHit(10, 4, 6)).isFalse();
      assertThat(HitWindow.canHit(11, 4, 4)).isFalse();
      assertThat(HitWindow.canHit(11, 4, 5)).isTrue();
    }

    @Test
    void guardsFollowHits() {
      assertThat(Guard.NONE.afterFullHit(5)).isEqualTo(new Guard(20, 5));
      assertThat(new Guard(15, 4).afterPartialHit(6)).isEqualTo(new Guard(15, 6));
      assertThat(new Guard(11, 0).inWindow()).isTrue();
      assertThat(new Guard(10, 0).inWindow()).isFalse();
    }
  }

  @Nested
  final class Knockbacks {

    private final SplittableRandom random = new SplittableRandom(1);

    @Test
    void aPlainHitPushesAwayAndUp() {
      var params = Knockback.Params.hit(Vec3.ZERO, new Vec3(1, 0, 0), Vec3.ZERO, 0);

      assertThat(Knockback.compute(params, random)).isEqualTo(new Vec3(0.4, 0.4, 0));
    }

    @Test
    void sprintingAddsHalfABlockOfPushAndALittleLift() {
      var params = Knockback.Params.hit(Vec3.ZERO, new Vec3(1, 0, 0), Vec3.ZERO, 1);

      assertThat(Knockback.compute(params, random)).isEqualTo(new Vec3(0.9, 0.5, 0));
    }

    @Test
    void theVictimKeepsHalfTheirVelocity() {
      var params = Knockback.Params.hit(Vec3.ZERO, new Vec3(0, 0, 1), new Vec3(0, 0, -1), 0);

      var result = Knockback.compute(params, random);
      assertThat(result.x()).isZero();
      assertThat(result.y()).isEqualTo(0.4);
      assertThat(result.z()).isCloseTo(-0.1, within(1e-9));
    }

    @Test
    void standingInsideTheVictimStillPushesSomewhere() {
      var params = Knockback.Params.hit(Vec3.ZERO, Vec3.ZERO, Vec3.ZERO, 0);

      var result = Knockback.compute(params, random);

      assertThat(result.y()).isEqualTo(0.4);
      assertThat(Math.hypot(result.x(), result.z())).isCloseTo(0.4, within(1e-9));
    }

    @Test
    void realKnockbackIsLiftedToAtLeastATenth() {
      assertThat(Knockback.finish(new Vec3(0.3, 0, 0))).isEqualTo(new Vec3(0.3, 0.1, 0));
      assertThat(Knockback.finish(new Vec3(0.05, 0, 0))).isEqualTo(new Vec3(0.05, 0, 0));
    }

    @Test
    void punchArrowsAndSprintResets() {
      var arrow = Knockback.arrow(new Vec3(0.4, 0.4, 0), 3);
      assertThat(arrow.x()).isCloseTo(1.8, within(1e-9));
      assertThat(arrow.y()).isEqualTo(0.1);
      assertThat(arrow.z()).isZero();
      assertThat(Knockback.arrow(new Vec3(0.4, 0.4, 0), 0)).isEqualTo(Vec3.ZERO);

      var reset = Knockback.sprintReset(new Vec3(1, 2, 3));
      assertThat(reset.x()).isCloseTo(0.6, within(1e-9));
      assertThat(reset.y()).isEqualTo(2);
      assertThat(reset.z()).isCloseTo(1.8, within(1e-9));
    }
  }

  @Nested
  final class Rules {

    @Test
    void theConstantsAreRedWarfares() {
      assertThat(CombatRules.COMBAT_RULES_VERSION).isEqualTo("rwf-combat-1");
      assertThat(CombatRules.ATTACK_SPEED_MODIFIER).isEqualTo(200);
      assertThat(CombatRules.PROJECTILE_HITBOX).isEqualTo(new CombatRules.Hitbox(0.75F, 0.5F));
      assertThat(CombatRules.STEAK_HEALTH).isEqualTo(8);
      assertThat(CombatRules.HUNGER).isFalse();
      assertThat(CombatRules.MAX_NO_DAMAGE_TICKS).isEqualTo(20);
    }

    @Test
    void steakHealsEightUnlessNearlyFull() {
      assertThat(CombatRules.steakHeal(10, 20)).contains(8.0);
      assertThat(CombatRules.steakHeal(15, 20)).contains(5.0);
      assertThat(CombatRules.steakHeal(19.5, 20)).isEmpty();
    }

    @Test
    void attackTypeFlagsImplyEachOther() {
      assertThat(AttackType.FALL.has(AttackType.Flag.IGNORE_ARMOR)).isTrue();
      assertThat(AttackType.FALL.has(AttackType.Flag.IGNORE_RATE)).isTrue();
      assertThat(AttackType.FIRE_ASPECT.has(AttackType.Flag.BURN)).isTrue();
      assertThat(AttackType.MELEE.knockback()).isTrue();
      assertThat(AttackType.END_OF_GAME.knockback()).isFalse();
      assertThat(AttackType.ALL).hasSize(35);
    }
  }
}
