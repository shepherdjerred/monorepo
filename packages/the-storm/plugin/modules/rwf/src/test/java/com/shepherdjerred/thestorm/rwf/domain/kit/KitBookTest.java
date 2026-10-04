package com.shepherdjerred.thestorm.rwf.domain.kit;

import static com.shepherdjerred.thestorm.rwf.testing.Samples.T0;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Vec3;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

final class KitBookTest {

  @Nested
  final class Kits {

    @Test
    void everyKitCarriesTheBombFuseInSlotZeroAndIsFree() {
      for (var kit : KitBook.MILESTONE_ONE) {
        assertThat(kit.items().getFirst()).isEqualTo(KitSpec.FUSE);
        assertThat(kit.price()).isZero();
        assertThat(kit.availability()).isEqualTo(KitAvailability.FREE);
        assertThat(kit.fuseBonus()).isEmpty();
        assertThat(kit.armor()).hasSize(4);
      }
      assertThat(KitSpec.FUSE.material()).isEqualTo("BLAZE_POWDER");
      assertThat(KitSpec.FUSE.name()).contains("Bomb Fuse");
    }

    @Test
    void trooperHasASharpIronSwordThreeGoldenApplesAndFullIron() {
      var trooper = KitBook.TROOPER;

      assertThat(trooper.hotbar())
          .containsExactly(
              ItemSpec.of("IRON_SWORD").enchanted("sharpness", 1), ItemSpec.of("GOLDEN_APPLE", 3));
      assertThat(trooper.armor())
          .extracting(ItemSpec::material)
          .containsExactly("IRON_BOOTS", "IRON_LEGGINGS", "IRON_CHESTPLATE", "IRON_HELMET");
      assertThat(trooper.ability()).isEmpty();
    }

    @Test
    void theArchersDifferInSwordAndBow() {
      assertThat(KitBook.LONGBOW.hotbar().get(1).enchantments())
          .containsOnlyKeys("infinity", "punch")
          .containsEntry("punch", 3);
      assertThat(KitBook.LONGBOW.hotbar().getFirst()).isEqualTo(ItemSpec.of("STONE_SWORD"));
      assertThat(KitBook.SHORTBOW.hotbar().getFirst())
          .isEqualTo(ItemSpec.of("WOODEN_SWORD").enchanted("knockback", 1));
      assertThat(KitBook.SHORTBOW.hotbar().get(1).enchantments())
          .containsOnlyKeys("infinity", "power")
          .containsEntry("power", 2);
      for (var archer : List.of(KitBook.LONGBOW, KitBook.SHORTBOW)) {
        assertThat(archer.armor())
            .extracting(ItemSpec::material)
            .containsExactly(
                "CHAINMAIL_BOOTS", "IRON_LEGGINGS", "IRON_CHESTPLATE", "CHAINMAIL_HELMET");
      }
    }

    @Test
    void rewindCarriesATimeMachineAndAProtectedChestplate() {
      var rewind = KitBook.REWIND;

      assertThat(rewind.hotbar())
          .containsExactly(ItemSpec.of("IRON_SWORD"), ItemSpec.of("CLOCK").named("Time Machine"));
      assertThat(rewind.armor().get(2))
          .isEqualTo(
              ItemSpec.armor("IRON_CHESTPLATE", ArmorSlot.CHESTPLATE).enchanted("protection", 1));
      assertThat(rewind.armor().get(3).material()).isEqualTo("CHAINMAIL_HELMET");
      assertThat(rewind.ability()).contains(Rewinder.ABILITY);
    }

    @Test
    void kitsAreFoundById() {
      assertThat(KitBook.byId("shortbow")).contains(KitBook.SHORTBOW);
      assertThat(KitBook.byId("ninja")).isEmpty();
    }

    @Test
    void aKitSpecRejectsNonsense() {
      assertThatThrownBy(
              () ->
                  new KitSpec(
                      "x",
                      "X",
                      "d",
                      100,
                      KitAvailability.FREE,
                      Optional.empty(),
                      List.of(),
                      List.of(),
                      Optional.empty()))
          .isInstanceOf(IllegalArgumentException.class)
          .hasMessageContaining("PURCHASE");
      assertThatThrownBy(
              () ->
                  new KitSpec(
                      "x",
                      "X",
                      "d",
                      0,
                      KitAvailability.FREE,
                      Optional.empty(),
                      List.of(),
                      List.of(
                          ItemSpec.armor("IRON_BOOTS", ArmorSlot.BOOTS),
                          ItemSpec.armor("GOLDEN_BOOTS", ArmorSlot.BOOTS)),
                      Optional.empty()))
          .isInstanceOf(IllegalArgumentException.class)
          .hasMessageContaining("two pieces");
    }
  }

  @Nested
  final class Rewinding {

    private static Vec3 at(int second) {
      return new Vec3(second, 64, 0);
    }

    @Test
    void theClockStartsOnCooldown() {
      var clock = Rewinder.start(T0);

      assertThat(clock.ready(T0.plusSeconds(29))).isFalse();
      assertThat(clock.ready(T0.plusSeconds(30))).isTrue();
      assertThat(clock.use(T0)).isEqualTo(Result.err(RewindError.COOLING_DOWN));
    }

    @Test
    void withNoTrailThereIsNowhereToLand() {
      assertThat(Rewinder.start(T0).use(T0.plusSeconds(30)))
          .isEqualTo(Result.err(RewindError.NO_LANDING));
    }

    @Test
    void theClockLandsWhereThePlayerStoodAboutThirtySecondsAgo() {
      var clock = Rewinder.start(T0);
      for (var second = 0; second <= 40; second++) {
        clock = clock.track(at(second), T0.plusSeconds(second));
      }

      var rewind =
          clock
              .use(T0.plusSeconds(40))
              .fold(
                  ok -> ok,
                  error -> {
                    throw new AssertionError(error);
                  });

      assertThat(rewind.to()).isEqualTo(at(9));
      assertThat(rewind.next().trail().samples()).isEmpty();
      assertThat(rewind.next().ready(T0.plusSeconds(69))).isFalse();
      assertThat(rewind.next().ready(T0.plusSeconds(70))).isTrue();
    }

    @Test
    void theTrailKeepsTheOldestSampleUntilTheNextIsAlsoOutOfTheWindow() {
      var trail = RewindTrail.empty().record(at(0), T0).record(at(20), T0.plusSeconds(20));

      assertThat(trail.record(at(49), T0.plusSeconds(49)).landing()).contains(at(0));
      assertThat(trail.record(at(51), T0.plusSeconds(51)).landing()).contains(at(20));
    }

    @Test
    void theTrailIsBounded() {
      var trail = new RewindTrail(List.of(), 3);
      for (var second = 0; second < 10; second++) {
        trail = trail.record(at(second), T0.plusSeconds(second));
      }

      assertThat(trail.samples()).hasSize(3);
      assertThat(trail.landing()).contains(at(7));
    }

    @Test
    void dyingForgetsTheTrail() {
      var clock = Rewinder.start(T0).track(at(0), T0).died();

      assertThat(clock.trail().samples()).isEmpty();
    }
  }
}
