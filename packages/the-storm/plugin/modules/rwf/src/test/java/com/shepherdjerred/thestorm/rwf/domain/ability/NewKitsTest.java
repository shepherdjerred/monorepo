package com.shepherdjerred.thestorm.rwf.domain.ability;

import static com.shepherdjerred.thestorm.rwf.testing.Samples.ALICE;
import static com.shepherdjerred.thestorm.rwf.testing.Samples.BOB;
import static com.shepherdjerred.thestorm.rwf.testing.Samples.CAROL;
import static com.shepherdjerred.thestorm.rwf.testing.Samples.DAVE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Bannerman;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Decoy;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Engineer;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Grappler;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Saboteur;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Spotter;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Tracker;
import com.shepherdjerred.thestorm.rwf.domain.combat.AttackType;
import com.shepherdjerred.thestorm.rwf.domain.combat.DamageFormula;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.geometry.BlockPos;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Vec3;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchSnapshot;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.SplittableRandom;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

/** The new kits: Sapper, Saboteur, Spotter, Grappler, Bannerman, Engineer, Tracker and Decoy. */
final class NewKitsTest {

  private static Bout duel(String kit) {
    var bout =
        new Bout()
            .with(ALICE, TeamColor.RED, kit)
            .with(BOB, TeamColor.RED, "trooper")
            .with(CAROL, TeamColor.BLUE, "trooper")
            .with(DAVE, TeamColor.BLUE, "trooper");
    bout.start();
    return bout;
  }

  private static boolean refused(List<AbilityEffect> effects) {
    return effects.stream()
        .anyMatch(
            e -> e instanceof AbilityEffect.Say say && say.tone() == AbilityEffect.Tone.REFUSED);
  }

  @Test
  void aSapperTakesHalfFromExplosionsOnly() {
    var side = new KitCombat.Side("sapper", KitState.NONE);
    var random = new SplittableRandom(1);

    assertThat(
            KitCombat.damage(
                DamageFormula.Hit.of(AttackType.EXPLOSION, 10, List.of()),
                Optional.empty(),
                side,
                random))
        .isEqualTo(5);
    assertThat(
            KitCombat.damage(
                DamageFormula.Hit.of(AttackType.MELEE, 10, List.of()),
                Optional.empty(),
                side,
                random))
        .isEqualTo(10);
  }

  @Nested
  final class SaboteurKit {

    private static final BlockPos SITE = new BlockPos(0, 64, 0);

    private MatchSnapshot.BombView view(MatchSnapshot.BombView.State state) {
      return new MatchSnapshot.BombView(
          "b",
          false,
          Optional.of(TeamColor.BLUE),
          SITE,
          state,
          MatchSnapshot.BombView.progressOf(state));
    }

    @Test
    void hidesItsTeamsArmingFromEveryOtherTeam() {
      var arming = view(new MatchSnapshot.BombView.State.Arming(TeamColor.RED, 0.4, List.of()));

      assertThat(Saboteur.hides(arming, Optional.empty(), TeamColor.BLUE, Set.of(TeamColor.RED)))
          .isTrue();
      assertThat(Saboteur.hides(arming, Optional.empty(), TeamColor.RED, Set.of(TeamColor.RED)))
          .as("its own team sees")
          .isFalse();
      assertThat(Saboteur.hides(arming, Optional.empty(), TeamColor.BLUE, Set.of(TeamColor.GREEN)))
          .as("only a team with a living Saboteur hides")
          .isFalse();
    }

    @Test
    void hidesTheCountdownUntilTenSecondsAreLeft() {
      var early = view(new MatchSnapshot.BombView.State.Armed(25, Optional.empty()));
      var late = view(new MatchSnapshot.BombView.State.Armed(Saboteur.REVEAL, Optional.empty()));
      var defusing =
          view(
              new MatchSnapshot.BombView.State.Armed(
                  25,
                  Optional.of(
                      new MatchSnapshot.BombView.State.Arming(TeamColor.BLUE, 0.1, List.of()))));
      var red = Optional.of(TeamColor.RED);
      var sabotaging = Set.of(TeamColor.RED);

      assertThat(Saboteur.hides(early, red, TeamColor.BLUE, sabotaging)).isTrue();
      assertThat(Saboteur.hides(late, red, TeamColor.BLUE, sabotaging)).isFalse();
      assertThat(Saboteur.hides(defusing, red, TeamColor.BLUE, sabotaging))
          .as("defusers see what they defuse")
          .isFalse();
      assertThat(Saboteur.hides(early, Optional.empty(), TeamColor.BLUE, sabotaging)).isFalse();
      assertThat(
              Saboteur.hides(
                  view(new MatchSnapshot.BombView.State.Idle()), red, TeamColor.BLUE, sabotaging))
          .isFalse();
    }
  }

  @Nested
  final class SpotterKit {

    @Test
    void marksEnemiesInSightForItsTeamThenRecharges() {
      var bout = duel("spotter");

      var effects = bout.act(ALICE, new AbilityInput.Spot(List.of(CAROL, BOB, DAVE, CAROL)));

      assertThat(effects)
          .filteredOn(AbilityEffect.Glow.class::isInstance)
          .containsExactly(
              new AbilityEffect.Glow(CAROL, TeamColor.RED, Spotter.GLOW),
              new AbilityEffect.Glow(DAVE, TeamColor.RED, Spotter.GLOW));
      assertThat(effects).contains(new AbilityEffect.Cue(ALICE, KitCue.SPOTTED));
      assertThat(refused(bout.act(ALICE, new AbilityInput.Spot(List.of(CAROL))))).isTrue();
      bout.advance(Spotter.RECHARGE);
      assertThat(bout.act(ALICE, new AbilityInput.Spot(List.of(CAROL))))
          .contains(new AbilityEffect.Glow(CAROL, TeamColor.RED, Spotter.GLOW));
    }

    @Test
    void seeingNobodyCostsNothing() {
      var bout = duel("spotter");

      assertThat(bout.act(ALICE, new AbilityInput.Spot(List.of(BOB)))).isEmpty();
      assertThat(bout.abilities.ready(ALICE, Spotter.ID, bout.now)).isTrue();
    }
  }

  @Nested
  final class GrapplerKit {

    @Test
    void reelingInPullsTowardTheHookAndSoftensTheLanding() {
      var bout = duel("grappler");
      bout.tick(Map.of(ALICE, Bout.still(Vec3.ZERO)));

      var effects = bout.act(ALICE, new AbilityInput.Grapple(new Vec3(0, 0, 10)));

      assertThat(effects)
          .contains(
              new AbilityEffect.Push(ALICE, Grappler.pull(Vec3.ZERO, new Vec3(0, 0, 10))),
              new AbilityEffect.NoFall(ALICE, Grappler.SAFE_LANDING),
              new AbilityEffect.Cue(ALICE, KitCue.PULLED));
      assertThat(refused(bout.act(ALICE, new AbilityInput.Grapple(new Vec3(0, 0, 10))))).isTrue();
      bout.advance(Grappler.RECHARGE);
      assertThat(bout.act(ALICE, new AbilityInput.Grapple(new Vec3(0, 0, 10))))
          .anyMatch(AbilityEffect.Push.class::isInstance);
    }

    @Test
    void aFarHookPullsNoFasterThanTheCap() {
      assertThat(Grappler.pull(Vec3.ZERO, new Vec3(0, 0, 10)).z()).isCloseTo(1.5, within(1e-9));
      var pull = Grappler.pull(Vec3.ZERO, new Vec3(100, 0, 0));

      assertThat(pull.x()).isCloseTo(Grappler.MOST_SPEED, within(1e-9));
      assertThat(pull.y()).isCloseTo(Grappler.LIFT, within(1e-9));
    }
  }

  @Nested
  final class BannermanKit {

    private static final BlockPos AT = new BlockPos(0, 65, 0);

    @Test
    void plantsOneBannerThatRegeneratesAlliesNearby() {
      var bout = duel("bannerman");

      var planted = bout.act(ALICE, new AbilityInput.PlantBanner(AT));

      assertThat(planted)
          .contains(
              new AbilityEffect.PlaceBlock(AT, "RED_BANNER"),
              new AbilityEffect.Take(ALICE, "RED_BANNER", 1));
      assertThat(bout.abilities.placedAt(AT)).isPresent();
      var pulse =
          bout.tick(
              Map.of(
                  ALICE, Bout.still(new Vec3(0, 65, 0)),
                  BOB, Bout.still(new Vec3(3, 65, 0)),
                  CAROL, Bout.still(new Vec3(2, 65, 0))));
      var regen = AbilityEffect.Potion.class;
      assertThat(pulse)
          .filteredOn(regen::isInstance)
          .map(regen::cast)
          .extracting(AbilityEffect.Potion::id)
          .containsExactlyInAnyOrder(BOB);
      assertThat(refused(bout.act(ALICE, new AbilityInput.PlantBanner(new BlockPos(5, 65, 5)))))
          .isTrue();
    }

    @Test
    void enemiesTearItDownInThreeStrikesAndTheItemComesBack() {
      var bout = duel("bannerman");
      bout.act(ALICE, new AbilityInput.PlantBanner(AT));

      assertThat(bout.act(BOB, new AbilityInput.StrikeBanner(AT)))
          .as("allies do not strike it")
          .isEmpty();
      bout.act(CAROL, new AbilityInput.StrikeBanner(AT));
      bout.act(CAROL, new AbilityInput.StrikeBanner(AT));
      assertThat(bout.abilities.placedAt(AT)).isPresent();
      var torn = bout.act(DAVE, new AbilityInput.StrikeBanner(AT));

      assertThat(torn)
          .contains(
              new AbilityEffect.ClearBlock(AT), new AbilityEffect.Give(ALICE, Bannerman.item(), 1));
      assertThat(bout.abilities.placedAt(AT)).isEmpty();
      assertThat(refused(bout.act(ALICE, new AbilityInput.PlantBanner(AT))))
          .as("still recharging")
          .isTrue();
      bout.advance(Bannerman.RECHARGE);
      assertThat(bout.act(ALICE, new AbilityInput.PlantBanner(AT)))
          .contains(new AbilityEffect.PlaceBlock(AT, "RED_BANNER"));
    }

    @Test
    void theBannerFallsWithItsBannerman() {
      var bout = duel("bannerman");
      bout.act(ALICE, new AbilityInput.PlantBanner(AT));

      assertThat(bout.kill(ALICE, CAROL)).contains(new AbilityEffect.ClearBlock(AT));
      assertThat(bout.abilities.placedAt(AT)).isEmpty();
    }
  }

  @Nested
  final class EngineerKit {

    private static List<BlockPos> wall(int x) {
      return List.of(
          new BlockPos(x, 65, -1),
          new BlockPos(x, 66, -1),
          new BlockPos(x, 65, 0),
          new BlockPos(x, 66, 0),
          new BlockPos(x, 65, 1),
          new BlockPos(x, 66, 1));
    }

    @Test
    void raisesAWallForEightSecondsThenItCrumbles() {
      var bout = duel("engineer");

      var raised = bout.act(ALICE, new AbilityInput.Barricade(wall(20)));

      assertThat(raised)
          .filteredOn(AbilityEffect.PlaceBlock.class::isInstance)
          .hasSize(6)
          .allMatch(e -> ((AbilityEffect.PlaceBlock) e).material().equals(Engineer.BLOCK));
      assertThat(refused(bout.act(ALICE, new AbilityInput.Barricade(wall(30))))).isTrue();
      bout.advance(Duration.ofSeconds(7));
      assertThat(bout.tick(Map.of())).noneMatch(AbilityEffect.ClearBlock.class::isInstance);
      bout.advance(Duration.ofSeconds(1));
      assertThat(bout.tick(Map.of()))
          .filteredOn(AbilityEffect.ClearBlock.class::isInstance)
          .hasSize(6);
      assertThat(bout.abilities.placed()).isEmpty();
    }

    @Test
    void neverWithinFourBlocksOfABomb() {
      var bout = duel("engineer");
      bout.bombs.add(new BlockPos(23, 65, 0));

      assertThat(refused(bout.act(ALICE, new AbilityInput.Barricade(wall(20))))).isTrue();
      assertThat(bout.act(ALICE, new AbilityInput.Barricade(wall(18))))
          .anyMatch(AbilityEffect.PlaceBlock.class::isInstance);
    }

    @Test
    void noRoomNoWall() {
      var bout = duel("engineer");

      assertThat(refused(bout.act(ALICE, new AbilityInput.Barricade(List.of())))).isTrue();
      assertThat(bout.abilities.ready(ALICE, Engineer.ID, bout.now)).isTrue();
    }
  }

  @Nested
  final class TrackerKit {

    @Test
    void theFirstHitOnAnEnemyMarksItForTheTeam() {
      var bout = duel("tracker");

      var first = bout.hit(ALICE, CAROL, AttackType.MELEE, "IRON_SWORD");

      assertThat(first).contains(new AbilityEffect.Mark(CAROL, TeamColor.RED));
      assertThat(bout.hit(ALICE, CAROL, AttackType.MELEE, "IRON_SWORD"))
          .noneMatch(AbilityEffect.Mark.class::isInstance);
      assertThat(bout.hit(ALICE, BOB, AttackType.MELEE, "IRON_SWORD"))
          .noneMatch(AbilityEffect.Mark.class::isInstance);
      assertThat(bout.state(ALICE, Tracker.State.class).marked()).containsExactly(CAROL);
    }
  }

  @Nested
  final class DecoyKit {

    @Test
    void sendsACopyTheWayItLooksAndHidesForThreeSeconds() {
      var bout = duel("decoy");
      Map<CombatantId, Motion> still = Map.of(ALICE, Bout.still(Vec3.ZERO));

      var sent = bout.act(ALICE, new AbilityInput.Decoy(new Vec3(0, 1, 2)));

      assertThat(sent)
          .contains(
              new AbilityEffect.Decoy(ALICE, new Vec3(0, 0, 1), Decoy.RUNS),
              new AbilityEffect.Visibility(ALICE, AbilityEffect.Seen.HIDDEN));
      bout.advance(Duration.ofSeconds(2));
      assertThat(bout.tick(still)).isEmpty();
      bout.advance(Duration.ofSeconds(1));
      assertThat(bout.tick(still))
          .containsExactly(new AbilityEffect.Visibility(ALICE, AbilityEffect.Seen.VISIBLE));
      assertThat(refused(bout.act(ALICE, new AbilityInput.Decoy(new Vec3(1, 0, 0))))).isTrue();
      bout.advance(Decoy.RECHARGE);
      assertThat(bout.act(ALICE, new AbilityInput.Decoy(new Vec3(1, 0, 0))))
          .anyMatch(AbilityEffect.Decoy.class::isInstance);
    }

    @Test
    void dyingWhileHiddenShowsItAgain() {
      var bout = duel("decoy");
      bout.act(ALICE, new AbilityInput.Decoy(new Vec3(1, 0, 0)));

      assertThat(bout.kill(ALICE, CAROL))
          .contains(new AbilityEffect.Visibility(ALICE, AbilityEffect.Seen.VISIBLE));
    }

    @Test
    void lookingStraightUpSendsNothing() {
      var bout = duel("decoy");

      assertThat(refused(bout.act(ALICE, new AbilityInput.Decoy(new Vec3(0, 1, 0))))).isTrue();
    }
  }
}
