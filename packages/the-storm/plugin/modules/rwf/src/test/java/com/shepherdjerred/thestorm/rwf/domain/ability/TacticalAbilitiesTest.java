package com.shepherdjerred.thestorm.rwf.domain.ability;

import static com.shepherdjerred.thestorm.rwf.testing.Samples.ALICE;
import static com.shepherdjerred.thestorm.rwf.testing.Samples.BOB;
import static com.shepherdjerred.thestorm.rwf.testing.Samples.CAROL;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Quartermaster;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Smokescreen;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Tactician;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Warden;
import com.shepherdjerred.thestorm.rwf.domain.combat.AttackType;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Vec3;
import com.shepherdjerred.thestorm.rwf.domain.kit.ItemSpec;
import java.time.Duration;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;

final class TacticalAbilitiesTest {
  private static Bout on(String kit) {
    var bout =
        new Bout()
            .with(ALICE, TeamColor.RED, kit)
            .with(BOB, TeamColor.RED, "trooper")
            .with(CAROL, TeamColor.BLUE, "trooper");
    bout.start();
    positions(bout, 6);
    return bout;
  }

  private static void positions(Bout bout, double allyDistance) {
    bout.tick(
        Map.of(
            ALICE,
            Bout.still(Vec3.ZERO),
            BOB,
            Bout.still(new Vec3(allyDistance, 0, 0)),
            CAROL,
            Bout.still(Vec3.ZERO)));
  }

  @Test
  void quartermasterHasThreeFiniteAlliedWavesAtTheInclusiveSixBlockBoundary() {
    var bout = on(Quartermaster.ID);
    for (var use = 0; use < 3; use++) {
      assertThat(bout.act(ALICE, new TacticalInput.Supply(Vec3.ZERO)))
          .containsExactly(
              new AbilityEffect.Cooldown(ALICE, Quartermaster.ID, Quartermaster.RECHARGE),
              new AbilityEffect.Take(ALICE, "BUNDLE", 1),
              new AbilityEffect.Give(BOB, ItemSpec.of("ARROW", 8), Integer.MAX_VALUE),
              new AbilityEffect.Potion(BOB, "absorption", 0, 80, Optional.of(ALICE)));
      assertThat(bout.act(ALICE, new TacticalInput.Supply(Vec3.ZERO))).isEmpty();
      bout.advance(Quartermaster.RECHARGE.minusMillis(1));
      assertThat(bout.act(ALICE, new TacticalInput.Supply(Vec3.ZERO))).isEmpty();
      bout.advance(Duration.ofMillis(1));
    }
    assertThat(bout.act(ALICE, new TacticalInput.Supply(Vec3.ZERO))).isEmpty();
    assertThat(bout.state(ALICE, Quartermaster.State.class).bundles()).isZero();
  }

  @Test
  void emptyOutOfRangeAndDeadAlliesDoNotConsumeSupply() {
    var bout = on(Quartermaster.ID);
    positions(bout, 6.001);
    assertThat(bout.act(ALICE, new TacticalInput.Supply(Vec3.ZERO))).isEmpty();
    assertThat(bout.state(ALICE, Quartermaster.State.class).bundles()).isEqualTo(3);
    positions(bout, 2);
    bout.kill(BOB, CAROL);
    assertThat(bout.act(ALICE, new TacticalInput.Supply(Vec3.ZERO))).isEmpty();
  }

  @Test
  void wardenAndSmokeDeployOnceUntilTheirIndependentCooldownsExpire() {
    var warden = on(Warden.ID);
    assertThat(warden.act(ALICE, new TacticalInput.Deploy(Vec3.ZERO)))
        .containsExactly(
            new AbilityEffect.Cooldown(ALICE, Warden.ID, Warden.RECHARGE),
            new TacticalEffect.ListeningPost(ALICE, Vec3.ZERO));
    warden.advance(Warden.RECHARGE.minusMillis(1));
    assertThat(warden.act(ALICE, new TacticalInput.Deploy(Vec3.ZERO))).isEmpty();
    warden.advance(Duration.ofMillis(1));
    assertThat(warden.act(ALICE, new TacticalInput.Deploy(Vec3.ZERO)))
        .containsExactly(
            new AbilityEffect.Cooldown(ALICE, Warden.ID, Warden.RECHARGE),
            new TacticalEffect.ListeningPost(ALICE, Vec3.ZERO));
    var smoke = on(Smokescreen.ID);
    assertThat(smoke.act(ALICE, new TacticalInput.Smoke(Vec3.ZERO)))
        .containsExactly(
            new AbilityEffect.Cooldown(ALICE, Smokescreen.ID, Smokescreen.RECHARGE),
            new TacticalEffect.Smoke(ALICE, Vec3.ZERO));
    assertThat(smoke.act(ALICE, new TacticalInput.Smoke(Vec3.ZERO))).isEmpty();
    smoke.advance(Smokescreen.RECHARGE);
    assertThat(smoke.act(ALICE, new TacticalInput.Smoke(Vec3.ZERO)))
        .containsExactly(
            new AbilityEffect.Cooldown(ALICE, Smokescreen.ID, Smokescreen.RECHARGE),
            new TacticalEffect.Smoke(ALICE, Vec3.ZERO));
  }

  @Test
  void hornRequiresTheEntireStationaryWindupAndNeverUsesStackingEffects() {
    var bout = on(Tactician.ID);
    positions(bout, 8);
    assertThat(bout.act(ALICE, new TacticalInput.Rally(Vec3.ZERO)))
        .containsExactly(new TacticalEffect.RallySignal(ALICE, TacticalEffect.Stage.WINDUP));
    assertThat(bout.act(ALICE, new TacticalInput.Rally(Vec3.ZERO))).isEmpty();
    bout.advance(Tactician.WINDUP.minusMillis(1));
    assertThat(bout.tick(Map.of(ALICE, Bout.still(Vec3.ZERO)))).isEmpty();
    bout.advance(Duration.ofMillis(1));
    assertThat(bout.tick(Map.of(ALICE, Bout.still(Vec3.ZERO))))
        .containsExactly(
            new AbilityEffect.Cooldown(ALICE, Tactician.ID, Tactician.RECHARGE),
            new AbilityEffect.Potion(BOB, "speed", 0, 120, Optional.of(ALICE)),
            new AbilityEffect.Potion(BOB, "resistance", 0, 120, Optional.of(ALICE)),
            new TacticalEffect.RallySignal(ALICE, TacticalEffect.Stage.COMPLETE));
    assertThat(bout.act(ALICE, new TacticalInput.Rally(Vec3.ZERO))).isEmpty();
    bout.advance(Tactician.RECHARGE);
    assertThat(bout.act(ALICE, new TacticalInput.Rally(Vec3.ZERO))).isNotEmpty();
  }

  @Test
  void movingBeingHurtDeathAndRoundEndCancelPendingHorns() {
    var bout = on(Tactician.ID);
    bout.act(ALICE, new TacticalInput.Rally(Vec3.ZERO));
    assertThat(bout.tick(Map.of(ALICE, Bout.still(new Vec3(0.151, 0, 0)))))
        .containsExactly(new TacticalEffect.RallySignal(ALICE, TacticalEffect.Stage.CANCELLED));
    bout.act(ALICE, new TacticalInput.Rally(Vec3.ZERO));
    assertThat(bout.act(ALICE, new AbilityInput.Hurt(Optional.of(CAROL), AttackType.MELEE, 1)))
        .containsExactly(new TacticalEffect.RallySignal(ALICE, TacticalEffect.Stage.CANCELLED));
    bout.act(ALICE, new TacticalInput.Rally(Vec3.ZERO));
    assertThat(bout.end())
        .containsExactly(new TacticalEffect.RallySignal(ALICE, TacticalEffect.Stage.CANCELLED));
    bout.act(ALICE, new TacticalInput.Rally(Vec3.ZERO));
    assertThat(bout.kill(ALICE, CAROL))
        .contains(new TacticalEffect.RallySignal(ALICE, TacticalEffect.Stage.CANCELLED));
  }
}
