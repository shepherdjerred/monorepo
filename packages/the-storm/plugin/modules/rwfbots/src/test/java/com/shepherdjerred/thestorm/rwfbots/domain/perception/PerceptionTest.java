package com.shepherdjerred.thestorm.rwfbots.domain.perception;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.BLUE;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.combatant;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.levers;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Facing;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.map.SyntheticMap;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.MatchPhase;
import com.shepherdjerred.thestorm.rwfbots.domain.world.PoisonView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Stimulus;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.util.List;
import java.util.SplittableRandom;
import org.junit.jupiter.api.Test;

final class PerceptionTest {

  private static final NavArtifact NAV = SyntheticMap.bake();

  private final Perception perception =
      new Perception(new SenseContext(NAV.grid(), NAV.graph(), NAV.regions(), levers(0.8)));
  private final SplittableRandom random = new SplittableRandom(1);

  /** A red viewer at x=10 looking east (-yaw 90 faces -X, so +X is yaw -90). */
  private static CombatantView viewer(double z) {
    return combatant(1, RED, new Vec3(10.5, 1, z)).withFacing(new Facing(-90, 0));
  }

  private static WorldSnapshot world(long tick, List<CombatantView> views, List<Stimulus> sounds) {
    return new WorldSnapshot(
        tick, MatchPhase.LIVE, views, List.of(), PoisonView.NONE, "synthetic", sounds);
  }

  private Percept perceive(CombatantView self, WorldSnapshot snapshot) {
    return perception.perceive(PerceptionState.EMPTY, self, snapshot, random);
  }

  @Test
  void seesAnEnemyInTheOpenButNotBehindTheWall() {
    var self = viewer(5.5);
    var nearEnemy = combatant(2, BLUE, new Vec3(14.5, 1, 5.5));
    var hiddenEnemy = combatant(3, BLUE, new Vec3(22.5, 1, 5.5));
    var percept = perceive(self, world(10, List.of(self, nearEnemy, hiddenEnemy), List.of()));
    assertThat(percept.visible()).extracting(CombatantView::id).containsExactly(new CombatantId(2));
  }

  @Test
  void seesThroughGlassAndTheDoor() {
    var throughGlass = viewer(20.5);
    var behindGlass = combatant(2, BLUE, new Vec3(22.5, 1, 20.5));
    assertThat(
            perceive(throughGlass, world(10, List.of(throughGlass, behindGlass), List.of()))
                .sees(behindGlass.id()))
        .isTrue();
    var atDoor = viewer(15.5);
    var beyondDoor = combatant(3, BLUE, new Vec3(22.5, 1, 15.5));
    assertThat(
            perceive(atDoor, world(10, List.of(atDoor, beyondDoor), List.of()))
                .sees(beyondDoor.id()))
        .isTrue();
  }

  @Test
  void ignoresEnemiesBehindTheViewerUnlessPointBlank() {
    var self = viewer(5.5);
    var behind = combatant(2, BLUE, new Vec3(4.5, 1, 5.5));
    var pointBlank = combatant(3, BLUE, new Vec3(9.5, 1, 5.5));
    var percept = perceive(self, world(10, List.of(self, behind, pointBlank), List.of()));
    assertThat(percept.sees(behind.id())).isFalse();
    assertThat(percept.sees(pointBlank.id())).isTrue();
  }

  @Test
  void invisiblePlayersShowOnlyThroughArmorHitsOrPointBlankLuck() {
    var self = viewer(5.5);
    var ghost = combatant(2, BLUE, new Vec3(14.5, 1, 5.5)).withInvisible(true, 0);
    assertThat(perceive(self, world(10, List.of(self, ghost), List.of())).sees(ghost.id()))
        .isFalse();
    var armored = ghost.withInvisible(true, 8);
    assertThat(perceive(self, world(10, List.of(self, armored), List.of())).sees(ghost.id()))
        .isTrue();
    var justHit = ghost.withLastHurtTick(5);
    assertThat(perceive(self, world(10, List.of(self, justHit), List.of())).sees(ghost.id()))
        .isTrue();
    var closeGhost = ghost.withPos(new Vec3(12.0, 1, 5.5));
    var noticed = 0;
    for (var i = 0; i < 200; i++) {
      if (perceive(self, world(10, List.of(self, closeGhost), List.of())).sees(ghost.id())) {
        noticed++;
      }
    }
    assertThat(noticed).isBetween(20, 80);
  }

  @Test
  void aSpyCountsAsAnAllyUntilItHitsOneOfOurs() {
    var self = viewer(5.5);
    var ally = combatant(4, RED, new Vec3(12.5, 1, 6.5));
    var spy = combatant(2, BLUE, new Vec3(13.5, 1, 5.5)).withDisguised(true);
    var quiet = perceive(self, world(10, List.of(self, ally, spy), List.of()));
    assertThat(quiet.visible()).isEmpty();
    assertThat(quiet.state().suspicion().isRevealed(spy.id())).isFalse();

    var evidence = Stimulus.hit(ally.pos(), 11, spy.id(), ally.id());
    var caught =
        perception.perceive(
            quiet.state(), self, world(11, List.of(self, ally, spy), List.of(evidence)), random);
    assertThat(caught.state().suspicion().isRevealed(spy.id())).isTrue();
    assertThat(caught.sees(spy.id())).isTrue();
  }

  @Test
  void aSpyTouchingOurBombIsCaught() {
    var self = viewer(15.5);
    var spy = combatant(2, BLUE, new Vec3(5.5, 1, 16.5)).withDisguised(true);
    var bomb =
        new com.shepherdjerred.thestorm.rwfbots.domain.world.BombView(
            new com.shepherdjerred.thestorm.rwfbots.domain.world.BombId(0),
            new com.shepherdjerred.thestorm.rwfbots.domain.world.BombOwner.Team(RED),
            SyntheticMap.RED_BOMB.center(),
            new com.shepherdjerred.thestorm.rwfbots.domain.world.BombState.Idle());
    var click = Stimulus.by(Stimulus.Kind.FUSE_CLICK, bomb.pos(), 10, spy.id());
    var snapshot =
        new WorldSnapshot(
            10,
            MatchPhase.LIVE,
            List.of(self, spy),
            List.of(bomb),
            PoisonView.NONE,
            "synthetic",
            List.of(click));
    assertThat(perceive(self, snapshot).state().suspicion().isRevealed(spy.id())).isTrue();
  }

  @Test
  void soundsPlaceEnemiesWithDistanceScaledError() {
    var self = viewer(5.5);
    var shooter = combatant(2, BLUE, new Vec3(22.5, 1, 5.5));
    var shot = Stimulus.by(Stimulus.Kind.BOW_SHOT, shooter.pos(), 10, shooter.id());
    var percept = perceive(self, world(10, List.of(self, shooter), List.of(shot)));
    assertThat(percept.sees(shooter.id())).isFalse();
    var heard = percept.state().memory().of(shooter.id()).orElseThrow();
    assertThat(heard.direct()).isFalse();
    assertThat(heard.confidence()).isEqualTo(Perception.SOUND_CONFIDENCE);
    var maxError = Stimulus.Kind.BOW_SHOT.baseError() * (12.0 / Stimulus.Kind.BOW_SHOT.range());
    assertThat(heard.pos().distance(shooter.pos())).isLessThanOrEqualTo(maxError + 1e-9);
  }

  @Test
  void memoryDecaysExponentiallyAndIsPruned() {
    var sighting = new Sighting(Vec3.ZERO, Vec3.ZERO, 100, 1, true);
    assertThat(sighting.confidenceAt(100, Perception.TAU_TICKS)).isEqualTo(1);
    assertThat(sighting.confidenceAt(300, Perception.TAU_TICKS))
        .isCloseTo(Math.exp(-1), within(1e-12));
    var memory = Memory.EMPTY.remember(new CombatantId(2), sighting);
    assertThat(memory.prune(300, Perception.TAU_TICKS).sightings()).hasSize(1);
    assertThat(memory.prune(100 + 800, Perception.TAU_TICKS).sightings()).isEmpty();
    var older = new Sighting(new Vec3(1, 0, 0), Vec3.ZERO, 50, 1, true);
    assertThat(memory.remember(new CombatantId(2), older)).isSameAs(memory);
  }
}
