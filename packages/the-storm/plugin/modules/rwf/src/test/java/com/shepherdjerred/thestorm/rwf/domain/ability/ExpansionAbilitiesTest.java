package com.shepherdjerred.thestorm.rwf.domain.ability;

import static com.shepherdjerred.thestorm.rwf.testing.Samples.ALICE;
import static com.shepherdjerred.thestorm.rwf.testing.Samples.BOB;
import static com.shepherdjerred.thestorm.rwf.testing.Samples.CAROL;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Acrobat;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Alchemist;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Knight;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Marksman;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Ravager;
import com.shepherdjerred.thestorm.rwf.domain.combat.AttackType;
import com.shepherdjerred.thestorm.rwf.domain.combat.DamageFormula;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Vec3;
import com.shepherdjerred.thestorm.rwf.domain.kit.ItemSpec;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.SplittableRandom;
import org.junit.jupiter.api.Test;

/** Balance boundaries, cooldowns and team restrictions of the approved expansion abilities. */
final class ExpansionAbilitiesTest {
  private static Bout on(String kit) {
    var bout =
        new Bout()
            .with(ALICE, TeamColor.RED, kit)
            .with(BOB, TeamColor.RED, "trooper")
            .with(CAROL, TeamColor.BLUE, "trooper");
    bout.start();
    return bout;
  }

  private static double damage(Bout bout, String kit, AttackType type) {
    return KitCombat.damage(
        DamageFormula.Hit.of(type, 6, List.of()),
        Optional.of(new KitCombat.Side(kit, bout.abilities.state(ALICE))),
        new KitCombat.Side("trooper", KitState.NONE),
        new SplittableRandom(1));
  }

  @Test
  void duelistBonusRequiresAnIsolatedMeleeHit() {
    var bout = on("duelist");
    bout.act(ALICE, new ExpansionInput.StrikeFacts(AttackType.MELEE, true, 2, false));
    assertThat(damage(bout, "duelist", AttackType.MELEE)).isEqualTo(7.5);
    assertThat(damage(bout, "duelist", AttackType.PROJECTILE)).isEqualTo(6);
    bout.act(ALICE, new ExpansionInput.StrikeFacts(AttackType.MELEE, false, 2, false));
    assertThat(damage(bout, "duelist", AttackType.MELEE)).isEqualTo(6);
  }

  @Test
  void knightCounterRequiresATimelyBlockIsConsumedOnceAndExpires() {
    var bout = on(Knight.ID);
    bout.act(ALICE, new ExpansionInput.ShieldBlock(9));
    assertThat(damage(bout, Knight.ID, AttackType.MELEE)).isEqualTo(6);
    bout.act(ALICE, new ExpansionInput.ShieldBlock(8));
    assertThat(damage(bout, Knight.ID, AttackType.MELEE)).isEqualTo(8);
    bout.hit(ALICE, CAROL, AttackType.MELEE, "IRON_SWORD");
    assertThat(damage(bout, Knight.ID, AttackType.MELEE)).isEqualTo(6);
    bout.act(ALICE, new ExpansionInput.ShieldBlock(1));
    assertThat(bout.state(ALICE, Knight.State.class).primed()).isFalse();
    bout.advance(Knight.RECHARGE);
    bout.act(ALICE, new ExpansionInput.ShieldBlock(1));
    bout.advance(Duration.ofSeconds(3));
    bout.act(ALICE, new ExpansionInput.StrikeFacts(AttackType.MELEE, true, 2, false));
    assertThat(damage(bout, Knight.ID, AttackType.MELEE)).isEqualTo(6);
  }

  @Test
  void ravagerBreaksOnlyEnemyShieldsAndWaitsTwelveSeconds() {
    var bout = on(Ravager.ID);
    assertThat(bout.act(ALICE, new ExpansionInput.ShieldContact(BOB))).isEmpty();
    assertThat(bout.act(ALICE, new ExpansionInput.ShieldContact(CAROL)))
        .contains(new ExpansionEffect.DisableShield(CAROL, 60));
    assertThat(bout.act(ALICE, new ExpansionInput.ShieldContact(CAROL))).isEmpty();
    bout.advance(Ravager.RECHARGE);
    assertThat(bout.act(ALICE, new ExpansionInput.ShieldContact(CAROL)))
        .contains(new ExpansionEffect.DisableShield(CAROL, 60));
  }

  @Test
  void acrobatNeedsAirAndALandingAsWellAsItsCooldown() {
    var bout = on(Acrobat.ID);
    assertThat(bout.act(ALICE, new ExpansionInput.AirJump(false, 0))).isEmpty();
    assertThat(bout.act(ALICE, new ExpansionInput.AirJump(true, -0.2)))
        .contains(new AbilityEffect.Push(ALICE, new Vec3(0, 0.8, 0)));
    bout.advance(Acrobat.RECHARGE);
    assertThat(bout.act(ALICE, new ExpansionInput.AirJump(true, 0))).isEmpty();
    bout.tick(Map.of(ALICE, Bout.still(Vec3.ZERO)));
    assertThat(bout.act(ALICE, new ExpansionInput.AirJump(true, 0)))
        .contains(new AbilityEffect.Push(ALICE, new Vec3(0, 0.6, 0)));
  }

  @Test
  void alchemistHasExactlyThreeThrowsAndCannotDebuffItsTeam() {
    var bout = on(Alchemist.ID);
    for (var i = 0; i < 3; i++) {
      assertThat(bout.act(ALICE, new ExpansionInput.ThrowFlask()))
          .contains(
              new ExpansionEffect.Flask(ALICE), new AbilityEffect.Take(ALICE, "SPLASH_POTION", 1));
      assertThat(bout.act(ALICE, new ExpansionInput.ThrowFlask())).isEmpty();
      bout.advance(Alchemist.RECHARGE);
    }
    assertThat(bout.act(ALICE, new ExpansionInput.ThrowFlask())).isEmpty();
    assertThat(bout.act(ALICE, new ExpansionInput.FlaskSplash(List.of(ALICE, BOB, CAROL, CAROL))))
        .containsExactly(
            new AbilityEffect.Potion(CAROL, "weakness", 0, 100, Optional.of(ALICE)),
            new AbilityEffect.Potion(CAROL, "slowness", 0, 100, Optional.of(ALICE)));
  }

  @Test
  void marksmanRewardsOnlyLongFullyDrawnLandedShotsAndRecharges() {
    var bout = on(Marksman.ID);
    bout.act(ALICE, new ExpansionInput.StrikeFacts(AttackType.PROJECTILE, false, 23.99, true));
    assertThat(damage(bout, Marksman.ID, AttackType.PROJECTILE)).isEqualTo(6);
    bout.act(ALICE, new ExpansionInput.StrikeFacts(AttackType.PROJECTILE, false, 24, false));
    assertThat(damage(bout, Marksman.ID, AttackType.PROJECTILE)).isEqualTo(6);
    bout.act(ALICE, new ExpansionInput.StrikeFacts(AttackType.PROJECTILE, false, 24, true));
    assertThat(damage(bout, Marksman.ID, AttackType.PROJECTILE)).isEqualTo(8);
    assertThat(bout.abilities.ready(ALICE, Marksman.ID, bout.now)).isTrue();
    bout.hit(ALICE, CAROL, AttackType.PROJECTILE, "BOW");
    bout.act(ALICE, new ExpansionInput.StrikeFacts(AttackType.PROJECTILE, false, 40, true));
    assertThat(damage(bout, Marksman.ID, AttackType.PROJECTILE)).isEqualTo(6);
    bout.advance(Marksman.RECHARGE);
    bout.act(ALICE, new ExpansionInput.StrikeFacts(AttackType.PROJECTILE, false, 24, true));
    assertThat(damage(bout, Marksman.ID, AttackType.PROJECTILE)).isEqualTo(8);
  }

  @Test
  void scavengerSalvageIsCollectedOnlyByItsOwnerAndExpiresAfterTenSeconds() {
    var bout = on("scavenger");
    bout.tick(
        Map.of(
            ALICE,
            Bout.still(Vec3.ZERO),
            BOB,
            Bout.still(new Vec3(10, 0, 0)),
            CAROL,
            Bout.still(new Vec3(10, 0, 0))));
    assertThat(bout.kill(CAROL, ALICE))
        .contains(new ExpansionEffect.Salvage(ALICE, CAROL, new Vec3(10, 0, 0)));
    assertThat(bout.tick(Map.of(ALICE, Bout.still(Vec3.ZERO), BOB, Bout.still(new Vec3(10, 0, 0)))))
        .noneMatch(AbilityEffect.Heal.class::isInstance);
    assertThat(bout.tick(Map.of(ALICE, Bout.still(new Vec3(10, 0, 0)))))
        .contains(
            new AbilityEffect.Heal(ALICE, 4),
            new AbilityEffect.Give(ALICE, ItemSpec.of("ARROW", 8), 64));
    assertThat(bout.tick(Map.of(ALICE, Bout.still(new Vec3(10, 0, 0))))).isEmpty();

    var expired = on("scavenger");
    expired.tick(Map.of(ALICE, Bout.still(Vec3.ZERO), CAROL, Bout.still(new Vec3(10, 0, 0))));
    expired.kill(CAROL, ALICE);
    expired.advance(Duration.ofSeconds(10));
    assertThat(expired.tick(Map.of(ALICE, Bout.still(new Vec3(10, 0, 0)))))
        .contains(new ExpansionEffect.ClearSalvage(ALICE, CAROL))
        .noneMatch(AbilityEffect.Heal.class::isInstance);
  }
}
