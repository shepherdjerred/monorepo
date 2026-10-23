package com.shepherdjerred.thestorm.rwfbots.domain.perception;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.BLUE;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.combatant;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.levers;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.difficulty.Levers;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Facing;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.map.SyntheticMap;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.MatchPhase;
import com.shepherdjerred.thestorm.rwfbots.domain.world.PoisonView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.util.List;
import java.util.SplittableRandom;
import org.junit.jupiter.api.Test;

/**
 * A standing enemy's name tag shows through walls; a crouched one shows less, and no tag at all.
 */
final class NameTagSightTest {

  private static final NavArtifact NAV = SyntheticMap.bake();

  /** A red bot at x=10 looking east, at the wall across x=16. */
  private static final CombatantView SELF =
      combatant(1, RED, new Vec3(10.5, 1, 5.5)).withFacing(new Facing(-90, 0));

  /** An enemy beyond the wall, twelve blocks east, in the bot's field of view. */
  private static final CombatantView WALLED = combatant(2, BLUE, new Vec3(22.5, 1, 5.5));

  private static Percept perceive(Levers levers, CombatantView self, CombatantView other) {
    var perception =
        new Perception(new SenseContext(NAV.grid(), NAV.graph(), NAV.regions(), levers));
    var world =
        new WorldSnapshot(
            10,
            MatchPhase.LIVE,
            List.of(self, other),
            List.of(),
            PoisonView.NONE,
            "synthetic",
            List.of(),
            List.of(), List.of());
    return perception.perceive(PerceptionState.EMPTY, self, world, new SplittableRandom(1));
  }

  private static Percept perceive(CombatantView other) {
    return perceive(levers(0.8), SELF, other);
  }

  @Test
  void aStandingEnemysNameTagPlacesItThroughTheWallWithoutSightOfIt() {
    var percept = perceive(WALLED);
    assertThat(percept.sees(WALLED.id())).as("its body is behind the wall").isFalse();
    assertThat(percept.state().memory().of(WALLED.id()))
        .hasValueSatisfying(
            tag -> {
              assertThat(tag.pos()).isEqualTo(WALLED.pos());
              assertThat(tag.confidence()).isEqualTo(Perception.NAME_TAG_CONFIDENCE);
              assertThat(tag.direct()).isFalse();
            });
  }

  @Test
  void noTagIsReadBehindTheBotBeyondRangeCrouchedHiddenInvisibleOrDisguised() {
    var behind = combatant(2, BLUE, new Vec3(2.5, 1, 5.5));
    var beyond = combatant(2, BLUE, SELF.pos().plus(Perception.NAME_TAG_RANGE + 2, 0, 0));
    for (var unseen :
        List.of(
            behind,
            beyond,
            WALLED.withNameTag(true, false),
            WALLED.withNameTag(false, true),
            WALLED.withInvisible(true, 0),
            WALLED.withDisguised(true))) {
      assertThat(perceive(unseen).state().memory().of(unseen.id())).as("%s", unseen).isEmpty();
    }
  }

  @Test
  void aCaughtSpysTagStillReadsAsOursAndPlacesNoEnemy() {
    var spy = WALLED.withDisguised(true);
    var caught = new PerceptionState(Memory.EMPTY, Suspicion.NONE.reveal(spy.id()));
    var world =
        new WorldSnapshot(
            10,
            MatchPhase.LIVE,
            List.of(SELF, spy),
            List.of(),
            PoisonView.NONE,
            "synthetic",
            List.of(),
            List.of(), List.of());
    var percept =
        new Perception(new SenseContext(NAV.grid(), NAV.graph(), NAV.regions(), levers(0.8)))
            .perceive(caught, SELF, world, new SplittableRandom(1));
    assertThat(percept.state().memory().of(spy.id())).isEmpty();
  }

  @Test
  void aCrouchedEnemyInTheOpenIsSeenOnlyWithinHalfTheAwarenessRadius() {
    var levers = levers(0);
    var radius = levers.awarenessRadius();
    // Looking south down the open west half of the arena.
    var self = combatant(1, RED, new Vec3(5.5, 1, 1.5)).withFacing(new Facing(0, 0));
    var midRange = 0.75 * radius;
    assertThat(midRange).isLessThan(29);
    var standing = combatant(2, BLUE, self.pos().plus(0, 0, midRange));
    assertThat(perceive(levers, self, standing).sees(standing.id())).isTrue();
    var crouched = standing.withNameTag(true, false);
    assertThat(perceive(levers, self, crouched).sees(crouched.id())).isFalse();
    var close = crouched.withPos(self.pos().plus(0, 0, 0.4 * radius));
    assertThat(perceive(levers, self, close).sees(close.id()))
        .as("up close a crouched enemy is seen as before")
        .isTrue();
  }
}
