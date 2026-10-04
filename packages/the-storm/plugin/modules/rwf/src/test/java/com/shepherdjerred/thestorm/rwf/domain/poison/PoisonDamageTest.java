package com.shepherdjerred.thestorm.rwf.domain.poison;

import static com.shepherdjerred.thestorm.rwf.testing.Samples.T0;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import com.shepherdjerred.thestorm.rwf.domain.geometry.Vec3;
import com.shepherdjerred.thestorm.rwf.domain.poison.PoisonDamage.Target;
import java.time.Duration;
import java.util.ArrayDeque;
import java.util.List;
import java.util.SplittableRandom;
import java.util.random.RandomGenerator;
import org.junit.jupiter.api.Test;

final class PoisonDamageTest {

  private static final Vec3 BOMB = new Vec3(0.5, 64.5, 0.5);

  /** A random source that hands out scripted draws, so the arithmetic can be checked by hand. */
  private static RandomGenerator scripted(double... draws) {
    var queue = new ArrayDeque<Double>();
    for (var draw : draws) {
      queue.add(draw);
    }
    return new RandomGenerator() {
      @Override
      public long nextLong() {
        throw new UnsupportedOperationException("only nextDouble is scripted");
      }

      @Override
      public double nextDouble() {
        return queue.remove();
      }
    };
  }

  @Test
  void theBaseIsThreeQuartersUntilElevenMinutesThenClimbsAHeartPointEveryTwoMinutes() {
    assertThat(PoisonDamage.extra(T0, T0)).isEqualTo(0.75);
    assertThat(PoisonDamage.extra(T0, T0.plus(Duration.ofMinutes(11)))).isEqualTo(0.75);
    assertThat(PoisonDamage.extra(T0, T0.plus(Duration.ofMinutes(13)))).isEqualTo(1.75);
    assertThat(PoisonDamage.extra(T0, T0.plus(Duration.ofMinutes(12)))).isEqualTo(1.25);
  }

  @Test
  void nearAnOwnBombTheRandomPartIsUpToOnePointAndFarAwayUpToHalf() {
    var near = new Target(BOMB.plus(new Vec3(14, 0, 0)), 20);
    var far = new Target(BOMB.plus(new Vec3(15, 0, 0)), 20);

    assertThat(PoisonDamage.amount(near, List.of(BOMB), 0.75, scripted(0.5))).isEqualTo(1.25);
    assertThat(PoisonDamage.amount(far, List.of(BOMB), 0.75, scripted(0.5))).isEqualTo(1.0);
  }

  @Test
  void theLargestProposalAmongOwnBombsIsDealt() {
    var other = BOMB.plus(new Vec3(100, 0, 0));
    var target = new Target(BOMB, 20);

    var amount = PoisonDamage.amount(target, List.of(BOMB, other), 0.75, scripted(0.2, 0.9));

    // Near: 0.75 + 0.2 × 1.0 = 0.95. Far: 0.75 + 0.9 × 0.5 = 1.2.
    assertThat(amount).isCloseTo(1.2, within(1e-9));
  }

  @Test
  void playersWithMoreThanTwentyMaxHealthTakeProportionallyMore() {
    var juggernaut = new Target(BOMB, 30);
    var frail = new Target(BOMB, 16);

    assertThat(PoisonDamage.amount(juggernaut, List.of(BOMB), 0.75, scripted(0.5)))
        .isEqualTo(1.875);
    assertThat(PoisonDamage.amount(frail, List.of(BOMB), 0.75, scripted(0.5))).isEqualTo(1.25);
  }

  @Test
  void aTeamWithNoBombsLeftTakesNoPoisonDamageAsInTheOriginal() {
    var target = new Target(BOMB, 20);

    assertThat(PoisonDamage.amount(target, List.of(), 5.0, scripted())).isZero();
  }

  @Test
  void aSeededRandomGivesTheSameDamageTwiceWithinTheExpectedRange() {
    var target = new Target(BOMB, 20);

    var first = PoisonDamage.amount(target, List.of(BOMB), 0.75, new SplittableRandom(42));
    var second = PoisonDamage.amount(target, List.of(BOMB), 0.75, new SplittableRandom(42));

    assertThat(first).isEqualTo(second).isBetween(0.75, 1.75);
  }
}
