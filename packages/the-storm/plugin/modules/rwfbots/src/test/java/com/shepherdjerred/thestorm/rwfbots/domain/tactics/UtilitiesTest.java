package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import static java.util.Comparator.comparingDouble;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.personality.Archetype;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Style;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Role;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import java.util.Map;
import org.junit.jupiter.api.Test;

final class UtilitiesTest {

  private static final Style STYLE = new Style(0.5, 0.5, 0.5, 0.5);

  private static Utilities.Temper temper(Role role, Archetype archetype, Kit kit) {
    return new Utilities.Temper(
        STYLE, 0.5, role, ArchetypeBias.of(archetype), ArchetypeBias.keep(kit, archetype));
  }

  private static final Utilities.Temper PLANTER =
      temper(Role.PLANT, Archetype.TACTICIAN, Kit.TROOPER);

  /** A healthy trooper with two allies, mid-map, nobody known, holding nothing. */
  private static final class F {
    double health = 1;
    double enemyDistance = Double.POSITIVE_INFINITY;
    int allies = 2;
    boolean ownBombLit;
    double enemyBombDistance = 30;
    boolean allyArming;
    boolean poison;
    double poisonIntensity;
    boolean inPoison;
    boolean hasRewind;
    double slotDistance = Double.POSITIVE_INFINITY;
    boolean plantSlot;
    boolean freeTarget = true;
    boolean rewindReady;

    F enemyAt(double distance) {
      enemyDistance = distance;
      return this;
    }

    Features build() {
      var known = Double.isFinite(enemyDistance);
      return new Features(
          health,
          enemyDistance,
          known ? 1 : 0,
          known ? 1 : 0,
          known ? 1 : 0,
          allies,
          2,
          ownBombLit,
          6,
          enemyBombDistance,
          allyArming,
          false,
          poison,
          poisonIntensity,
          inPoison,
          true,
          hasRewind,
          slotDistance,
          plantSlot,
          freeTarget,
          rewindReady);
    }
  }

  private static Option best(Map<Option, Double> scores) {
    return scores.entrySet().stream()
        .max(comparingDouble(entry -> entry.getValue().doubleValue()))
        .orElseThrow()
        .getKey();
  }

  @Test
  void aLitOwnBombMakesDefuseTheTopPriority() {
    var f = new F().enemyAt(10);
    f.ownBombLit = true;
    assertThat(best(Utilities.score(f.build(), PLANTER))).isEqualTo(Option.DEFUSE);
  }

  @Test
  void poisonAtTheOwnBombMustBeLeft() {
    var f = new F();
    f.poison = true;
    f.poisonIntensity = 0.5;
    f.inPoison = true;
    assertThat(best(Utilities.score(f.build(), PLANTER))).isEqualTo(Option.ESCAPE_POISON);
  }

  @Test
  void thePlantSlotGoesToArm() {
    var f = new F();
    f.plantSlot = true;
    f.slotDistance = 30;
    assertThat(best(Utilities.score(f.build(), PLANTER))).isEqualTo(Option.ARM);
  }

  @Test
  void everyoneElseTakesTheirSlotRatherThanBeelineToTheBomb() {
    var f = new F();
    f.slotDistance = 12;
    var scores = Utilities.score(f.build(), temper(Role.ROTATE, Archetype.TACTICIAN, Kit.TROOPER));
    assertThat(best(scores)).isEqualTo(Option.TAKE_SLOT);
    assertThat(scores.get(Option.ARM)).isZero();
    f.slotDistance = 1;
    assertThat(
            best(Utilities.score(f.build(), temper(Role.ROTATE, Archetype.TACTICIAN, Kit.TROOPER))))
        .isEqualTo(Option.HOLD_SLOT);
  }

  @Test
  void aBotNextToAnUnwatchedBombArmsItAnyway() {
    var f = new F();
    f.slotDistance = 12;
    f.enemyBombDistance = 5;
    assertThat(
            best(Utilities.score(f.build(), temper(Role.ROTATE, Archetype.TACTICIAN, Kit.TROOPER))))
        .isEqualTo(Option.ARM);
  }

  @Test
  void aStackedFuseDrawsTheEscort() {
    var f = new F();
    f.allyArming = true;
    f.enemyBombDistance = 10;
    f.slotDistance = 3;
    assertThat(
            best(Utilities.score(f.build(), temper(Role.ESCORT, Archetype.SUPPORT, Kit.TROOPER))))
        .isEqualTo(Option.HELP_ARM);
  }

  @Test
  void aSwordHoldsItsSlotAtRangeAndFightsUpClose() {
    var temper = temper(Role.ROTATE, Archetype.TACTICIAN, Kit.TROOPER);
    var far = new F().enemyAt(20);
    far.slotDistance = 10;
    assertThat(best(Utilities.score(far.build(), temper))).isEqualTo(Option.TAKE_SLOT);
    var close = new F().enemyAt(4);
    close.slotDistance = 10;
    assertThat(best(Utilities.score(close.build(), temper))).isEqualTo(Option.ENGAGE);
  }

  @Test
  void aBowFightsInsideItsBandButNotAcrossTheMap() {
    var temper = temper(Role.ROTATE, Archetype.SNIPER, Kit.LONGBOW);
    var inBand = new F().enemyAt(22);
    inBand.slotDistance = 2;
    assertThat(best(Utilities.score(inBand.build(), temper))).isEqualTo(Option.ENGAGE);
    // On the way to its slot it walks on rather than stop to snipe from the far edge of its band.
    var onTheWay = new F().enemyAt(22);
    onTheWay.slotDistance = 10;
    assertThat(best(Utilities.score(onTheWay.build(), temper))).isEqualTo(Option.TAKE_SLOT);
    var close = new F().enemyAt(8);
    close.slotDistance = 10;
    assertThat(best(Utilities.score(close.build(), temper))).isEqualTo(Option.ENGAGE);
    var acrossTheMap = new F().enemyAt(46);
    acrossTheMap.slotDistance = 10;
    assertThat(best(Utilities.score(acrossTheMap.build(), temper))).isEqualTo(Option.TAKE_SLOT);
  }

  @Test
  void anEnemyAlreadyChasedByTwoIsLeftAloneUnlessPointBlank() {
    var temper = temper(Role.ROTATE, Archetype.DUELIST, Kit.TROOPER);
    var chased = new F().enemyAt(6);
    chased.freeTarget = false;
    chased.slotDistance = 10;
    assertThat(best(Utilities.score(chased.build(), temper))).isNotEqualTo(Option.ENGAGE);
    chased.freeTarget = true;
    assertThat(best(Utilities.score(chased.build(), temper))).isEqualTo(Option.ENGAGE);
  }

  @Test
  void rewindOnlyWhenTheClockWouldHelp() {
    var f = new F().enemyAt(2);
    f.health = 0.2;
    f.hasRewind = true;
    var temper = temper(Role.ROTATE, Archetype.TACTICIAN, Kit.REWIND);
    assertThat(Utilities.score(f.build(), temper).get(Option.REWIND)).isZero();
    f.rewindReady = true;
    assertThat(best(Utilities.score(f.build(), temper))).isEqualTo(Option.REWIND);
  }

  @Test
  void aggressionRisesWithPoison() {
    var calm = new F().enemyAt(8);
    var late = new F().enemyAt(8);
    late.poison = true;
    late.poisonIntensity = 2;
    var temper = temper(Role.ROTATE, Archetype.TACTICIAN, Kit.TROOPER);
    assertThat(Utilities.score(late.build(), temper).get(Option.ENGAGE))
        .isGreaterThan(Utilities.score(calm.build(), temper).get(Option.ENGAGE));
  }

  @Test
  void archetypesBendTheUtilities() {
    var f = new F().enemyAt(8);
    var duelist = Utilities.score(f.build(), temper(Role.ROTATE, Archetype.DUELIST, Kit.TROOPER));
    var turtle = Utilities.score(f.build(), temper(Role.ROTATE, Archetype.TURTLE, Kit.TROOPER));
    assertThat(duelist.get(Option.ENGAGE)).isGreaterThan(turtle.get(Option.ENGAGE));
  }
}
