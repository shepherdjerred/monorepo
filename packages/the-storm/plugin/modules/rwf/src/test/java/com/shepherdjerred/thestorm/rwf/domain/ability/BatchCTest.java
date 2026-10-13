package com.shepherdjerred.thestorm.rwf.domain.ability;

import static com.shepherdjerred.thestorm.rwf.testing.Samples.ALICE;
import static com.shepherdjerred.thestorm.rwf.testing.Samples.BOB;
import static com.shepherdjerred.thestorm.rwf.testing.Samples.CAROL;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Explosive;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Skinner;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Wraith;
import com.shepherdjerred.thestorm.rwf.domain.combat.AttackType;
import com.shepherdjerred.thestorm.rwf.domain.combat.DamageFormula;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Vec3;
import com.shepherdjerred.thestorm.rwf.domain.kit.ItemSpec;
import com.shepherdjerred.thestorm.rwf.domain.kit.KitBook;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.SplittableRandom;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

/**
 * Batch C, the explosives and stealth kits: Explosive, Ghost, Wraith, Spy and Skinner, against Red
 * Warfare's numbers.
 */
final class BatchCTest {

  @Nested
  final class ExplosiveKit {

    @Test
    void anRpgLaunchesAndRechargesForThirtySeconds() {
      var bout = new Bout().with(ALICE, TeamColor.RED, "explosive");
      bout.start();

      assertThat(bout.act(ALICE, new AbilityInput.LaunchRpg()))
          .containsExactly(
              new AbilityEffect.Cooldown(ALICE, Explosive.RPG, Explosive.RPG_RECHARGE),
              new AbilityEffect.Take(ALICE, "EGG", 1),
              new AbilityEffect.Launch(ALICE, AbilityEffect.Projectile.RPG));
      assertThat(bout.act(ALICE, new AbilityInput.LaunchRpg())).isEmpty();
      var at = new Vec3(1, 64, 1);
      assertThat(bout.act(ALICE, new AbilityInput.Detonate(AbilityEffect.Projectile.RPG, at)))
          .containsExactly(
              new AbilityEffect.Explode(
                  at, 6.5F, 20, ALICE, KitAttacks.RPG, KitAttacks.RPG_SELF, 4));
    }

    @Test
    void fiveGrenadesFlyAtOnceThenTheThrowerWaits() {
      var bout = new Bout().with(ALICE, TeamColor.RED, "explosive");
      bout.start();

      for (var i = 0; i < Explosive.CHARGES; i++) {
        assertThat(bout.act(ALICE, new AbilityInput.ThrowGrenade()))
            .contains(new AbilityEffect.Launch(ALICE, AbilityEffect.Projectile.GRENADE));
      }
      assertThat(bout.act(ALICE, new AbilityInput.ThrowGrenade()))
          .containsExactly(
              new AbilityEffect.Say(
                  List.of(ALICE),
                  "You cannot throw another grenade for 5 seconds!",
                  AbilityEffect.Tone.REFUSED));
      var at = new Vec3(1, 64, 1);
      assertThat(bout.act(ALICE, new AbilityInput.Detonate(AbilityEffect.Projectile.GRENADE, at)))
          .containsExactly(
              new AbilityEffect.Explode(
                  at, 5.5F, 16, ALICE, KitAttacks.GRENADE, KitAttacks.GRENADE, 0));
    }

    @Test
    void aGrenadeArrivesOnTheSecondClockEightSecondsInThenEveryThirteenUnderTwenty() {
      var bout = new Bout().with(ALICE, TeamColor.RED, "explosive");
      bout.start();
      var give = new AbilityEffect.Give(ALICE, Explosive.grenade(), Integer.MAX_VALUE);

      bout.advance(Duration.ofSeconds(7));
      assertThat(bout.act(ALICE, stock(9))).isEmpty();
      bout.advance(Duration.ofSeconds(1));
      assertThat(bout.act(ALICE, stock(20))).as("twenty held: none, and no recharge").isEmpty();
      bout.advance(Duration.ofSeconds(1));
      assertThat(bout.act(ALICE, stock(19))).containsExactly(give);
      bout.advance(Duration.ofSeconds(12));
      assertThat(bout.act(ALICE, stock(10))).isEmpty();
      bout.advance(Duration.ofSeconds(1));
      assertThat(bout.act(ALICE, stock(10))).containsExactly(give);
      assertThat(
              bout.tick(Map.<CombatantId, Motion>of(ALICE, Bout.still(Vec3.ZERO))).stream()
                  .noneMatch(AbilityEffect.Give.class::isInstance))
          .as("nothing arrives between the server's once-a-second counts")
          .isTrue();
    }

    private static AbilityInput stock(int held) {
      return new AbilityInput.Stock(Explosive.GRENADE_MATERIAL, held);
    }

    @Test
    void explosionDamageFollowsRedWarfaresCurve() {
      assertThat(ExplosionDamage.of(0, 6, 1, 1000)).hasValue(49);
      assertThat(ExplosionDamage.of(3, 6, 1, 1000)).hasValue(19);
      assertThat(ExplosionDamage.of(3, 6, 1, 16)).hasValue(16);
      assertThat(ExplosionDamage.of(3, 6, 0, 1000)).hasValue(1);
      assertThat(ExplosionDamage.of(7, 6, 1, 1000)).isEmpty();
    }
  }

  @Nested
  final class GhostAndWraith {

    @Test
    void aGhostIsInvisibleFromTheStart() {
      var bout = new Bout().with(ALICE, TeamColor.RED, "ghost").with(BOB, TeamColor.BLUE, "wraith");

      assertThat(bout.start())
          .contains(
              new AbilityEffect.Visibility(ALICE, AbilityEffect.Seen.GHOST),
              new AbilityEffect.Visibility(BOB, AbilityEffect.Seen.GHOST));
    }

    @Test
    void hurtsGiveItAwayAndArrowsStickForTenSeconds() {
      var bout =
          new Bout().with(ALICE, TeamColor.RED, "ghost").with(BOB, TeamColor.BLUE, "shortbow");
      bout.start();
      var still = Map.<CombatantId, Motion>of(ALICE, Bout.still(Vec3.ZERO));
      var hit = bout.now;

      assertThat(bout.hit(BOB, ALICE, AttackType.PROJECTILE, "BOW"))
          .contains(new AbilityEffect.Cue(ALICE, KitCue.GHOST_HIT));
      assertThat(bout.act(ALICE, new AbilityInput.Hurt(Optional.empty(), AttackType.POISON, 1)))
          .as("the poison does not show a ghost")
          .isEmpty();
      bout.advance(Duration.ofSeconds(10));
      assertThat(bout.tick(still)).as("strictly more than ten seconds, as elasped").isEmpty();
      bout.advance(Duration.ofMillis(50));
      assertThat(bout.tick(still)).containsExactly(new AbilityEffect.Unstick(ALICE, hit));
    }

    @Test
    void aWraithsArrowComesBackTwoSecondsAfterItFlies() {
      var bout = new Bout().with(ALICE, TeamColor.RED, "wraith");
      bout.start();
      var still = Map.<CombatantId, Motion>of(ALICE, Bout.still(Vec3.ZERO));

      assertThat(bout.act(ALICE, new AbilityInput.ShootBow(9)))
          .contains(
              new AbilityEffect.Take(ALICE, "ARROW", 64),
              new AbilityEffect.Cooldown(ALICE, Wraith.ID, Wraith.RELOAD));
      bout.advance(Duration.ofSeconds(2));
      assertThat(bout.tick(still)).isEmpty();
      bout.advance(Duration.ofMillis(50));
      assertThat(bout.tick(still))
          .containsExactly(new AbilityEffect.SetSlot(ALICE, 9, ItemSpec.of("ARROW")));
    }
  }

  @Nested
  final class SpyKit {

    @Test
    void alwaysLooksLikeTheViewersOwn() {
      assertThat(
              new com.shepherdjerred.thestorm.rwf.domain.ability.kits.Spy()
                  .disguised(KitState.NONE))
          .isTrue();
      assertThat(new Skinner().disguised(KitState.NONE)).isFalse();
    }

    @Test
    void wearsEachViewersOwnColours() {
      var bout = new Bout().with(ALICE, TeamColor.RED, "spy");

      assertThat(bout.start())
          .containsExactly(
              new AbilityEffect.Disguise(
                  ALICE,
                  Optional.of(
                      new AbilityEffect.Disguised(
                          bout.fighters.getFirst().name(), Optional.empty()))));
    }
  }

  @Nested
  final class SkinnerKit {

    private Bout bout() {
      var bout =
          new Bout()
              .with(ALICE, TeamColor.RED, "skinner")
              .with(BOB, TeamColor.BLUE, "trooper")
              .with(CAROL, TeamColor.RED, "trooper");
      bout.start();
      bout.tick(
          Map.of(
              ALICE, Bout.still(new Vec3(0, 64, 0)),
              BOB, Bout.still(new Vec3(5, 64, 0)),
              CAROL, Bout.still(new Vec3(6, 64, 0))));
      return bout;
    }

    @Test
    void anEnemyDyingNearbyIsWornOnTheFirstHalfSecondBeatAfterThreeSeconds() {
      var bout = bout();
      var bob = bout.fighters.get(1);
      var alice = Map.<CombatantId, Motion>of(ALICE, Bout.still(new Vec3(0, 64, 0)));

      assertThat(bout.kill(BOB, CAROL)).contains(new AbilityEffect.SnapSkin(ALICE, BOB));
      assertThat(bout.state(ALICE, Skinner.State.class).dressing()).hasSize(1);
      bout.advance(Duration.ofSeconds(3));
      assertThat(bout.tick(alice))
          .as("exactly three seconds is not yet past, as elasped")
          .containsExactly(new AbilityEffect.Cue(ALICE, KitCue.SKINNING));
      bout.advance(Duration.ofMillis(500));
      var effects = bout.tick(alice);

      assertThat(effects)
          .contains(
              new AbilityEffect.Cue(ALICE, KitCue.SKINNING),
              new AbilityEffect.Disguise(
                  ALICE,
                  Optional.of(
                      new AbilityEffect.Disguised(bob.name(), Optional.of(TeamColor.BLUE)))),
              new AbilityEffect.Skin(ALICE, Optional.of(BOB)));
      assertThat(bout.state(ALICE, Skinner.State.class).dressing()).isEmpty();
      assertThat(bout.state(ALICE, Skinner.State.class).wearing()).contains(TeamColor.BLUE);
      assertThat(new Skinner().disguised(bout.state(ALICE, Skinner.State.class))).isTrue();
    }

    @Test
    void anAllysDeathOrAFarOneIsNotSkinned() {
      var bout = bout();

      bout.kill(CAROL, BOB);
      assertThat(bout.state(ALICE, Skinner.State.class).dressing()).isEmpty();
      bout.tick(
          Map.of(ALICE, Bout.still(new Vec3(-20, 64, 0)), BOB, Bout.still(new Vec3(5, 64, 0))));
      bout.kill(BOB, ALICE);
      assertThat(bout.state(ALICE, Skinner.State.class).dressing()).isEmpty();
    }

    @Test
    void whileDressingItsArmourStillGuardsIt() {
      var hit =
          DamageFormula.Hit.melee(KitBook.TROOPER.hotbar().getFirst(), KitBook.SKINNER.armor());
      var dressing =
          new Skinner.State(
              java.util.List.of(
                  new Skinner.Skin(BOB, "Bob", TeamColor.BLUE, java.time.Instant.EPOCH)),
              Optional.empty(),
              java.time.Instant.EPOCH);
      var trooper = Optional.of(new KitCombat.Side("trooper", KitState.NONE));

      var dressingDamage =
          KitCombat.damage(
              hit, trooper, new KitCombat.Side("skinner", dressing), new SplittableRandom(1));
      var dressedDamage =
          KitCombat.damage(
              hit, trooper, new KitCombat.Side("skinner", KitState.NONE), new SplittableRandom(1));

      assertThat(dressingDamage)
          .as("Red Warfare's code never made a dressing Skinner defenceless")
          .isCloseTo(dressedDamage, within(1e-9));
    }
  }
}
