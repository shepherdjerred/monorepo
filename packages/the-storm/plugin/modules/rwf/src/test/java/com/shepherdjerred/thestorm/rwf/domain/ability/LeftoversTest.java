package com.shepherdjerred.thestorm.rwf.domain.ability;

import static com.shepherdjerred.thestorm.rwf.testing.Samples.ALICE;
import static com.shepherdjerred.thestorm.rwf.testing.Samples.BOB;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Juggernaut;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Sacrificial;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Warper;
import com.shepherdjerred.thestorm.rwf.domain.combat.AttackType;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Vec3;
import java.time.Duration;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** Red Warfare behaviours the first ports missed: the Warper's trail, the Juggernaut's hop. */
final class LeftoversTest {

  private static Vec3 at(int x) {
    return new Vec3(x, 64, 0);
  }

  /** Alice stands at {@code at(x)} for {@code seconds}, ticking every 50 ms. */
  private static void stand(Bout bout, int x, int seconds) {
    for (var tick = 0; tick < seconds * 20; tick++) {
      bout.tick(Bout.motions(Map.of(ALICE, Bout.still(at(x)))));
      bout.advance(Duration.ofMillis(50));
    }
  }

  @Test
  void theWarpersOldestSpotStaysWhileTheSpotAfterItHasBecomeUnsafe() {
    var bout =
        new Bout().with(ALICE, TeamColor.RED, Warper.ID).with(BOB, TeamColor.BLUE, "trooper");
    bout.start();
    stand(bout, 0, 1);
    stand(bout, 1, 1);
    // The second spot has since been blown away: WarperAbility kept the safe one before it.
    bout.ground = feet -> feet.x() != 1;
    stand(bout, 2, 15);

    assertThat(bout.state(ALICE, Warper.State.class).landing().map(Warper.Stamp::at))
        .contains(at(0));

    bout.ground = feet -> true;
    stand(bout, 2, 1);
    assertThat(bout.state(ALICE, Warper.State.class).landing().map(Warper.Stamp::at))
        .contains(at(2));
  }

  @Test
  void aJuggernautHopsOnceATickAfterGoingLive() {
    var bout = new Bout().with(ALICE, TeamColor.RED, Juggernaut.ID);

    assertThat(bout.start()).noneMatch(AbilityEffect.Hop.class::isInstance);
    assertThat(bout.tick(Bout.motions(Map.of(ALICE, Bout.still(at(0))))))
        .containsExactly(new AbilityEffect.Hop(ALICE, 0.1));
    assertThat(bout.tick(Bout.motions(Map.of(ALICE, Bout.still(at(0))))))
        .noneMatch(AbilityEffect.Hop.class::isInstance);
  }

  @Test
  void aSacrificialTakesTheVoidOnlyWhenSomeoneSentTheAllyThere() {
    assertThat(Sacrificial.shields(AttackType.VOID)).isFalse();
    assertThat(Sacrificial.shields(AttackType.VOID_PUSHED)).isTrue();
    assertThat(Sacrificial.shields(AttackType.VOID_SHOT)).isTrue();
  }
}
