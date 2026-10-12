package com.shepherdjerred.thestorm.rwf.domain.kit;

import static com.shepherdjerred.thestorm.rwf.testing.Samples.T0;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Rewind;
import com.shepherdjerred.thestorm.rwf.domain.geometry.BlockPos;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Vec3;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.Function;
import java.util.function.Predicate;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

final class KitBookTest {

  private static final KitSpec.Menu MENU = new KitSpec.Menu("STONE", List.of("A stone"));

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
          .containsExactly(
              ItemSpec.of("IRON_SWORD"), ItemSpec.of("CLOCK").named("Time Machine", "gold"));
      assertThat(rewind.armor().get(2))
          .isEqualTo(
              ItemSpec.armor("IRON_CHESTPLATE", ArmorSlot.CHESTPLATE).enchanted("protection", 1));
      assertThat(rewind.armor().get(3).material()).isEqualTo("CHAINMAIL_HELMET");
      assertThat(rewind.ability()).contains(Rewind.ID);
    }

    @Test
    void everyKitHasAMenuIconAndASummaryThatFitsATooltip() {
      assertThat(KitBook.MILESTONE_ONE)
          .extracting(kit -> kit.menu().icon())
          .containsExactly("IRON_SWORD", "BOW", "BOW", "CLOCK");
      for (var kit : KitBook.MILESTONE_ONE) {
        assertThat(kit.menu().summary()).isNotEmpty().allMatch(line -> line.length() <= 40);
      }
      assertThatThrownBy(() -> new KitSpec.Menu("bow", List.of("x"))).hasMessageContaining("icon");
      assertThatThrownBy(() -> new KitSpec.Menu("BOW", List.of())).hasMessageContaining("1 to 4");
      assertThatThrownBy(() -> new KitSpec.Menu("BOW", List.of("x".repeat(41))))
          .hasMessageContaining("40 characters");
    }

    @Test
    void kitsAreFoundById() {
      assertThat(KitBook.byId("shortbow")).contains(KitBook.SHORTBOW);
      assertThat(KitBook.byId("ninja")).contains(KitBook.NINJA);
      assertThat(KitBook.byId("pirate")).isEmpty();
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
                      KitTier.BASIC,
                      KitAvailability.FREE,
                      Optional.empty(),
                      List.of(),
                      List.of(),
                      Optional.empty(),
                      MENU))
          .isInstanceOf(IllegalArgumentException.class)
          .hasMessageContaining("PURCHASE");
      assertThatThrownBy(
              () ->
                  new KitSpec(
                      "x",
                      "X",
                      "d",
                      0,
                      KitTier.BASIC,
                      KitAvailability.FREE,
                      Optional.empty(),
                      List.of(),
                      List.of(
                          ItemSpec.armor("IRON_BOOTS", ArmorSlot.BOOTS),
                          ItemSpec.armor("GOLDEN_BOOTS", ArmorSlot.BOOTS)),
                      Optional.empty(),
                      MENU))
          .isInstanceOf(IllegalArgumentException.class)
          .hasMessageContaining("two pieces");
    }
  }

  @Nested
  final class Rewinding {

    private static boolean safe(Vec3 position) {
      return true;
    }

    private static Vec3 at(int second) {
      return new Vec3(second, 64, 0);
    }

    private static RewindTrail.Spot spot(int second) {
      return new RewindTrail.Spot(at(second), second, -second);
    }

    @Test
    void theTrailKeepsTheOldestSampleUntilTheNextIsAlsoOutOfTheWindow() {
      var trail = RewindTrail.empty().record(spot(0), T0).record(spot(20), T0.plusSeconds(20));

      assertThat(trail.trimmed(T0.plusSeconds(50), Rewinding::safe).landing()).contains(spot(0));
      assertThat(trail.trimmed(T0.plusSeconds(51), Rewinding::safe).landing()).contains(spot(20));
      assertThat(trail.trimmed(T0.plusSeconds(50), Rewinding::safe)).isSameAs(trail);
    }

    @Test
    void anOldSafeSpotIsKeptWhileTheNextHasBecomeUnsafe() {
      var trail =
          RewindTrail.empty()
              .record(spot(0), T0)
              .record(spot(1), T0.plusSeconds(1))
              .record(spot(2), T0.plusSeconds(2));
      Predicate<Vec3> notOne = position -> position.x() != 1;
      Predicate<Vec3> notZero = position -> position.x() != 0;

      // The next spot is no longer safe: the old one stays as the landing.
      assertThat(trail.trimmed(T0.plusSeconds(60), notOne).landing()).contains(spot(0));
      // The oldest spot is no longer safe: it goes even though the next is no better.
      assertThat(trail.trimmed(T0.plusSeconds(60), notZero).landing()).contains(spot(2));
    }

    @Test
    void theTrailKeepsEverySampleUntilTrimmedLikeTheOriginal() {
      var trail = RewindTrail.empty();
      for (var tick = 0; tick < 2_000; tick++) {
        trail = trail.record(spot(tick), T0.plusMillis(tick * 50L));
      }

      assertThat(trail.samples()).hasSize(2_000);
      assertThat(trail.landing()).contains(spot(0));
    }
  }

  @Nested
  final class Landing {

    private static final BlockPos FEET = new BlockPos(0, 64, 0);

    /** A floor of stone at y 63 and air above, with {@code extra} blocks placed on top. */
    private static Function<BlockPos, SafeTeleport.Footing> world(
        Map<BlockPos, SafeTeleport.Footing> extra) {
      return block ->
          extra.getOrDefault(
              block, block.y() <= 63 ? SafeTeleport.Footing.STANDABLE : SafeTeleport.Footing.CLEAR);
    }

    @Test
    void openGroundWithHeadroomIsSafe() {
      assertThat(SafeTeleport.safe(FEET, -64, world(Map.of()))).isTrue();
    }

    @Test
    void aPressurePlateOrTripwireWithinOneBlockIsNot() {
      assertThat(
              SafeTeleport.safe(
                  FEET, -64, world(Map.of(new BlockPos(1, 65, -1), SafeTeleport.Footing.TRAP))))
          .isFalse();
      assertThat(
              SafeTeleport.safe(
                  FEET, -64, world(Map.of(new BlockPos(2, 64, 0), SafeTeleport.Footing.TRAP))))
          .isTrue();
    }

    @Test
    void theFeetAndHeadNeedRoom() {
      assertThat(
              SafeTeleport.safe(
                  FEET, -64, world(Map.of(new BlockPos(0, 65, 0), SafeTeleport.Footing.PARTIAL))))
          .isFalse();
      assertThat(SafeTeleport.safe(FEET, -64, world(Map.of(FEET, SafeTeleport.Footing.STANDABLE))))
          .isFalse();
    }

    @Test
    void somethingToStandOnWithinTwoBlocksBelow() {
      var gap = Map.of(new BlockPos(0, 63, 0), SafeTeleport.Footing.CLEAR);
      assertThat(SafeTeleport.safe(FEET, -64, world(gap))).isTrue();
      var hole =
          Map.of(
              new BlockPos(0, 63, 0),
              SafeTeleport.Footing.CLEAR,
              new BlockPos(0, 62, 0),
              SafeTeleport.Footing.CLEAR);
      assertThat(SafeTeleport.safe(FEET, -64, world(hole))).isFalse();
      var fence = Map.of(new BlockPos(0, 63, 0), SafeTeleport.Footing.PARTIAL);
      assertThat(SafeTeleport.safe(FEET, -64, world(fence))).isFalse();
    }

    @Test
    void nothingBelowTheWorldIsSafe() {
      assertThat(SafeTeleport.safe(new BlockPos(0, -65, 0), -64, world(Map.of()))).isFalse();
      assertThat(SafeTeleport.safe(new BlockPos(0, 64, 0), 63, world(Map.of()))).isTrue();
      // The original refused feet below y 1 in a world whose bottom was 0.
      assertThat(SafeTeleport.safe(new BlockPos(0, 64, 0), 64, world(Map.of()))).isFalse();
      var lowFloor = Map.of(new BlockPos(0, 63, 0), SafeTeleport.Footing.CLEAR);
      assertThat(SafeTeleport.safe(new BlockPos(0, 64, 0), 62, world(lowFloor))).isTrue();
      assertThat(SafeTeleport.safe(new BlockPos(0, 64, 0), 63, world(lowFloor))).isFalse();
    }

    @Test
    void trapsAreSoughtAtTheNineteenBlockFacesOneBlockDownLevelAndUp() {
      assertThat(SafeTeleport.FACES).hasSize(19).doesNotHaveDuplicates();
      for (var dy = -1; dy <= 1; dy++) {
        for (var face : SafeTeleport.FACES) {
          var trap = FEET.plus(face.x(), face.y() + dy, face.z());
          assertThat(SafeTeleport.safe(FEET, -64, world(Map.of(trap, SafeTeleport.Footing.TRAP))))
              .as("trap at %s", trap)
              .isFalse();
        }
      }
      // The up and down faces reach two blocks; the secondary directions reach two sideways.
      for (var trap :
          List.of(
              new BlockPos(0, 66, 0),
              new BlockPos(0, 62, 0),
              new BlockPos(-2, 63, -1),
              new BlockPos(1, 65, 2))) {
        assertThat(SafeTeleport.safe(FEET, -64, world(Map.of(trap, SafeTeleport.Footing.TRAP))))
            .as("trap at %s", trap)
            .isFalse();
      }
      // Corners two away and anything three away are outside the original's shape.
      for (var clear :
          List.of(
              new BlockPos(2, 64, 2),
              new BlockPos(-2, 64, -2),
              new BlockPos(2, 64, 0),
              new BlockPos(0, 67, 0),
              new BlockPos(0, 64, 3))) {
        assertThat(SafeTeleport.safe(FEET, -64, world(Map.of(clear, SafeTeleport.Footing.TRAP))))
            .as("trap at %s", clear)
            .isTrue();
      }
    }

    @Test
    void waterOrLavaAtTheFeetIsNotHeadroom() {
      assertThat(SafeTeleport.safe(FEET, -64, world(Map.of(FEET, SafeTeleport.Footing.PARTIAL))))
          .isFalse();
      assertThat(
              SafeTeleport.safe(
                  FEET, -64, world(Map.of(new BlockPos(0, 65, 0), SafeTeleport.Footing.PARTIAL))))
          .isFalse();
    }
  }
}
