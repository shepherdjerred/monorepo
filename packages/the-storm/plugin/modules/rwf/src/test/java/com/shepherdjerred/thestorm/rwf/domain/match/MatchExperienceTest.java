package com.shepherdjerred.thestorm.rwf.domain.match;

import static com.shepherdjerred.thestorm.rwf.testing.Samples.ALICE;
import static com.shepherdjerred.thestorm.rwf.testing.Samples.BOB;
import static com.shepherdjerred.thestorm.rwf.testing.Samples.BOT_1;
import static com.shepherdjerred.thestorm.rwf.testing.Samples.CAROL;
import static com.shepherdjerred.thestorm.rwf.testing.Samples.DAVE;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwf.domain.combat.AttackType;
import com.shepherdjerred.thestorm.rwf.domain.combat.Attribution;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.geometry.BlockPos;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Spawn;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Vec3;
import com.shepherdjerred.thestorm.rwf.domain.map.MapDefinition;
import com.shepherdjerred.thestorm.rwf.testing.Samples;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.OptionalDouble;
import java.util.UUID;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

/**
 * The match experience around the rules: the map vote, preparing, previewing and freezing, carrying
 * humans into the next match, and sharing a death between the killer and the assists.
 */
final class MatchExperienceTest {

  private static MapDefinition named(String id, String name) {
    var map = Samples.twoTeams();
    return new MapDefinition(
        id,
        name,
        "The Storm",
        map.teams(),
        map.bombs(),
        map.border(),
        map.spectatorPoint(),
        map.blocksSha256());
  }

  private static final MapDefinition HARBOUR = named("harbour", "Harbour");
  private static final MapDefinition CANYON = named("canyon", "Canyon");
  private static final MapDefinition DOCKS = named("docks", "Docks");

  private static List<NoticeKind> notices(List<MatchEffect> effects) {
    return effects.stream()
        .filter(MatchEffect.Announce.class::isInstance)
        .map(effect -> ((MatchEffect.Announce) effect).notice().kind())
        .toList();
  }

  private static List<Notice> told(List<MatchEffect> effects, CombatantId to) {
    return effects.stream()
        .filter(MatchEffect.Tell.class::isInstance)
        .map(MatchEffect.Tell.class::cast)
        .filter(tell -> tell.to().contains(to))
        .map(MatchEffect.Tell::notice)
        .toList();
  }

  private static <T extends MatchEffect> List<T> only(List<MatchEffect> effects, Class<T> type) {
    return effects.stream().filter(type::isInstance).map(type::cast).toList();
  }

  private static List<MatchEffect> tickFor(Play play, int seconds) {
    var effects = new ArrayList<MatchEffect>();
    for (var i = 0; i < seconds; i++) {
      effects.addAll(play.tick(1));
    }
    return effects;
  }

  /** A lobby playing the full flow with three maps on the ballot. */
  private static Play flow() {
    var play = new Play(Play.FLOW, Samples.T0);
    play.join(ALICE);
    play.join(BOB);
    play.ballot(HARBOUR, CANYON, DOCKS);
    return play;
  }

  @Nested
  final class TheVote {

    @Test
    void membersVoteUntilTheLeadAndTheMostVotedMapLoads() {
      var play = flow();
      assertThat(notices(play.ok(new MatchEvent.Vote(ALICE, "canyon")))).isEmpty();
      play.ok(new MatchEvent.Vote(BOB, "canyon"));
      play.tick(1);
      assertThat(play.match.phase()).isInstanceOf(Phase.Countdown.class);

      // The 90 s countdown: the vote stays open for its first 70 s.
      var before = tickFor(play, 69);
      assertThat(only(before, MatchEffect.PrepareMap.class)).isEmpty();
      var closing = tickFor(play, 1);

      assertThat(only(closing, MatchEffect.PrepareMap.class))
          .containsExactly(new MatchEffect.PrepareMap("canyon"));
      assertThat(notices(closing)).contains(NoticeKind.MAP_CHOSEN);
      assertThat(play.refused(new MatchEvent.Vote(ALICE, "docks")))
          .isEqualTo(MatchError.VOTE_CLOSED);
    }

    @Test
    void aLoneMemberWhoseLobbyHasRelaxedAsFarAsItGoesGetsTheMapLoadedForBots() {
      var settings =
          new MatchSettings(
              4,
              2,
              60,
              Duration.ofSeconds(90),
              Duration.ofSeconds(15),
              Duration.ofSeconds(15),
              Duration.ofMinutes(1),
              Duration.ofSeconds(20),
              Duration.ofSeconds(10),
              Duration.ofSeconds(5),
              true);
      var play = new Play(settings, Samples.T0);
      play.join(ALICE);
      play.ballot(HARBOUR, CANYON, DOCKS);
      play.tick(1);

      var waiting = tickFor(play, 28);
      assertThat(only(waiting, MatchEffect.PrepareMap.class)).isEmpty();
      var relaxed = tickFor(play, 2);

      assertThat(only(relaxed, MatchEffect.PrepareMap.class)).hasSize(1);
      assertThat(play.match.phase()).isInstanceOf(Phase.Lobby.class);
      play.join(BOT_1);
      play.tick(1);
      assertThat(play.match.phase()).isInstanceOf(Phase.Countdown.class);
    }

    @Test
    void aMapNotOnTheBallotOrAVoteBeforeItOpensIsRefused() {
      var play = new Play(Play.FLOW, Samples.T0);
      play.join(ALICE);
      assertThat(play.refused(new MatchEvent.Vote(ALICE, "canyon")))
          .isEqualTo(MatchError.NO_BALLOT);
      play.ballot(HARBOUR, CANYON);
      assertThat(play.refused(new MatchEvent.Vote(ALICE, "nowhere")))
          .isEqualTo(MatchError.NOT_ON_BALLOT);
      assertThat(play.refused(new MatchEvent.Vote(BOB, "canyon")))
          .isEqualTo(MatchError.NOT_A_MEMBER);
    }

    @Test
    void aVoterWhoLeavesTakesTheirVoteWithThem() {
      var play = flow();
      play.ok(new MatchEvent.Vote(BOB, "docks"));
      play.ok(new MatchEvent.Leave(BOB, play.now));

      assertThat(play.match.ballot().orElseThrow().count("docks")).isZero();
    }

    @Test
    void aFailedMapLeavesTheBallotAndTheVoteChoosesAgain() {
      var play = flow();
      play.ok(new MatchEvent.Vote(ALICE, "canyon"));
      play.ok(new MatchEvent.Vote(BOB, "canyon"));
      play.tick(1);
      tickFor(play, 70);

      var failed = play.ok(new MatchEvent.MapFailed("canyon"));

      assertThat(notices(failed)).contains(NoticeKind.MAP_FAILED);
      var ballot = play.match.ballot().orElseThrow();
      assertThat(ballot.candidates()).extracting(Ballot.Candidate::mapId).doesNotContain("canyon");
      assertThat(only(failed, MatchEffect.PrepareMap.class)).hasSize(1);
      assertThat(ballot.chosen()).isPresent();
    }

    @Test
    void anOperatorsMapReplacesTheVote() {
      var play = flow();
      var effects =
          play.ok(new MatchEvent.SetMap(new Ballot.Candidate("docks", "Docks", "The Storm")));

      assertThat(play.match.ballot().orElseThrow().chosen()).contains("docks");
      assertThat(only(effects, MatchEffect.PrepareMap.class))
          .containsExactly(new MatchEffect.PrepareMap("docks"));
    }
  }

  @Nested
  final class PreviewAndFreeze {

    /** Votes for Canyon, runs the countdown down and reports the map ready. */
    private Play toCountdownEnd(boolean readyInTime) {
      var play = flow();
      play.ok(new MatchEvent.Vote(ALICE, "canyon"));
      play.tick(1);
      tickFor(play, 75);
      if (readyInTime) {
        play.ready(CANYON);
      }
      tickFor(play, 15);
      return play;
    }

    @Test
    void aMapNotReadyWhenTheCountdownEndsIsPreparedFirst() {
      var play = toCountdownEnd(false);
      assertThat(play.match.phase()).isInstanceOf(Phase.Preparing.class);

      var effects = play.ready(CANYON);

      assertThat(play.match.phase()).isInstanceOf(Phase.Preview.class);
      assertThat(only(effects, MatchEffect.PreviewMap.class))
          .singleElement()
          .satisfies(preview -> assertThat(preview.ids()).containsExactly(ALICE, BOB));
      assertThat(notices(effects)).contains(NoticeKind.PREVIEW);
    }

    @Test
    void thePreviewKeepsKitsOpenThenTheFreezeDealsTeamsAndLocksEveryone() {
      var play = toCountdownEnd(true);
      assertThat(play.match.phase()).isInstanceOf(Phase.Preview.class);
      play.ok(new MatchEvent.PickKit(ALICE, "longbow"));
      play.join(CAROL);

      var frozen = tickFor(play, 10);

      assertThat(play.match.phase()).isInstanceOf(Phase.Freeze.class);
      assertThat(only(frozen, MatchEffect.Freeze.class))
          .singleElement()
          .satisfies(freeze -> assertThat(freeze.ids()).containsExactly(ALICE, BOB, CAROL));
      assertThat(only(frozen, MatchEffect.Equip.class))
          .contains(new MatchEffect.Equip(ALICE, "longbow"));
      assertThat(play.match.members()).allMatch(member -> member.team().isPresent());
      assertThat(play.refused(new MatchEvent.PickKit(BOB, "longbow")))
          .isEqualTo(MatchError.NOT_PRE_GAME);
      assertThat(play.refused(new MatchEvent.Join(DAVE, "Dave", play.now)))
          .isEqualTo(MatchError.IN_PROGRESS);

      var live = tickFor(play, 5);

      assertThat(play.match.phase()).isInstanceOf(Phase.Live.class);
      assertThat(only(live, MatchEffect.Unfreeze.class)).hasSize(1);
      assertThat(notices(live)).contains(NoticeKind.GAME_BEGUN);
    }

    @Test
    void anOperatorsStartDuringTheVoteClosesItAndWaitsForTheMap() {
      var play = flow();
      play.tick(1);
      assertThat(play.match.phase()).isInstanceOf(Phase.Countdown.class);

      var started = play.ok(new MatchEvent.ForceStart(play.now));

      assertThat(play.match.phase()).isInstanceOf(Phase.Preparing.class);
      assertThat(play.match.map()).isEmpty();
      assertThat(only(started, MatchEffect.PrepareMap.class)).hasSize(1);
      var chosen = play.match.ballot().orElseThrow().chosen().orElseThrow();
      var map =
          java.util.stream.Stream.of(HARBOUR, CANYON, DOCKS)
              .filter(m -> m.id().equals(chosen))
              .findFirst()
              .orElseThrow();
      play.ready(map);
      assertThat(play.match.phase()).isInstanceOf(Phase.Live.class);
    }

    @Test
    void anOperatorCanSkipAndExtendTheWaits() {
      var play = toCountdownEnd(true);
      play.ok(new MatchEvent.Extend(Duration.ofSeconds(30)));
      tickFor(play, 15);
      assertThat(play.match.phase()).isInstanceOf(Phase.Preview.class);

      play.ok(new MatchEvent.Skip(play.now));
      assertThat(play.match.phase()).isInstanceOf(Phase.Freeze.class);
      play.ok(new MatchEvent.Skip(play.now));
      assertThat(play.match.phase()).isInstanceOf(Phase.Live.class);
      assertThat(play.refused(new MatchEvent.Skip(play.now))).isEqualTo(MatchError.NOTHING_TO_SKIP);
    }

    @Test
    void startsAreAsFarFromThePlacedAsTheSpawnsAllowAndFaceTheSpectatorPoint() {
      var spawns =
          List.of(
              Spawn.at(new BlockPos(0, 64, 0)),
              Spawn.at(new BlockPos(10, 64, 0)),
              Spawn.at(new BlockPos(20, 64, 0)));
      var picked =
          StartSpawns.pick(spawns, List.of(new Vec3(0.5, 64, 0.5)), new Vec3(20.5, 64, 10.5));

      assertThat(picked.position()).isEqualTo(new Vec3(20.5, 64, 0.5));
      assertThat(picked.yaw()).isEqualTo(0f);
      assertThat(StartSpawns.facing(new Vec3(0, 0, 0), new Vec3(-1, 0, 0))).isEqualTo(90f);
    }
  }

  @Nested
  final class CarryOver {

    @Test
    void aMatchThatEndsOnItsOwnCarriesItsHumansAndReleasesItsBots() {
      var play = new Play(Play.FLOW, Samples.T0);
      play.join(ALICE);
      play.ok(new MatchEvent.PickKit(ALICE, "longbow"));
      play.join(BOB);
      play.ok(new MatchEvent.PickKit(BOB, "trooper"));
      play.join(BOT_1);
      play.start(HARBOUR);
      // One team falls: the match ends.
      var loser = play.teamOf(ALICE) == TeamColor.RED ? TeamColor.RED : TeamColor.BLUE;
      for (var member : play.on(loser)) {
        play.died(member.id(), Optional.empty());
      }
      assertThat(play.match.phase()).isInstanceOf(Phase.Ended.class);

      var reset = tickFor(play, 16);

      assertThat(play.match.phase()).isInstanceOf(Phase.Resetting.class);
      assertThat(only(reset, MatchEffect.ReturnToLobby.class))
          .containsExactlyInAnyOrder(
              new MatchEffect.ReturnToLobby(ALICE, "longbow"),
              new MatchEffect.ReturnToLobby(BOB, "trooper"));
      assertThat(only(reset, MatchEffect.Restore.class))
          .containsExactly(new MatchEffect.Restore(BOT_1));

      play.ok(new MatchEvent.ResetDone());
      var next = play.match.successor(Play.FLOW, new UUID(0, 2), 7, play.now);

      assertThat(next.matchId()).isEqualTo(new UUID(0, 2));
      assertThat(next.members()).extracting(Combatant::id).containsExactly(ALICE, BOB);
      assertThat(next.member(ALICE).orElseThrow().kit()).contains("longbow");
      assertThat(next.members()).allMatch(member -> member.team().isEmpty() && !member.alive());
      assertThat(next.members()).allMatch(member -> member.score().equals(Score.ZERO));
      assertThat(next.phase()).isInstanceOf(Phase.Lobby.class);
    }

    @Test
    void aCarriedMemberWhoLeavesIsRestoredExactlyOnce() {
      var play = new Play(Play.FLOW, Samples.T0);
      play.join(ALICE);
      play.join(BOB);
      play.start(HARBOUR);
      play.died(ALICE, Optional.of(BOB));
      tickFor(play, 16);
      var left = play.ok(new MatchEvent.Leave(ALICE, play.now));
      play.ok(new MatchEvent.ResetDone());

      assertThat(only(left, MatchEffect.Restore.class))
          .containsExactly(new MatchEffect.Restore(ALICE));
      assertThat(play.match.members()).extracting(Combatant::id).containsExactly(BOB);
    }

    @Test
    void aStopReleasesEveryoneAndCarriesNobody() {
      var play = new Play(Play.FLOW, Samples.T0);
      play.join(ALICE);
      play.join(BOB);
      play.start(HARBOUR);

      var stopped = play.ok(new MatchEvent.Stop());

      assertThat(only(stopped, MatchEffect.ReturnToLobby.class)).isEmpty();
      assertThat(only(stopped, MatchEffect.Restore.class)).hasSize(2);
      assertThat(play.match.members()).isEmpty();
    }

    @Test
    void withCarryOverOffAMatchThatEndsReleasesEveryone() {
      var play = new Play();
      play.join(ALICE);
      play.join(BOB);
      play.start(HARBOUR);
      play.died(ALICE, Optional.of(BOB));

      var reset = tickFor(play, 16);

      assertThat(only(reset, MatchEffect.ReturnToLobby.class)).isEmpty();
      assertThat(only(reset, MatchEffect.Restore.class)).hasSize(2);
    }
  }

  @Nested
  final class KillsAndAssists {

    private Play live() {
      var play = new Play();
      play.start(HARBOUR, ALICE, BOB, CAROL, DAVE);
      return play;
    }

    @Test
    void theKillerGetsAWholeKillAndTheOthersTheirShareAsAnAssist() {
      var play = live();
      var victim = play.anyOn(TeamColor.RED).id();
      var enemies = play.on(TeamColor.BLUE).stream().map(Combatant::id).toList();
      var killer = enemies.get(0);
      var helper = enemies.get(1);
      play.hurt(victim, helper, 12, 20);
      play.hurt(victim, killer, 8, 8);

      var effects =
          play.ok(
              new MatchEvent.Died(
                  victim,
                  new Attribution(
                      Optional.of(killer),
                      Map.of(),
                      AttackType.MELEE,
                      Optional.of("IRON_SWORD"),
                      OptionalDouble.of(2.5)),
                  OptionalDouble.of(14),
                  play.now));

      assertThat(play.member(killer).score()).isEqualTo(new Score(1, 0, 1));
      assertThat(play.member(helper).score().assists()).isEqualTo(1);
      assertThat(play.member(helper).score().killstreak()).isCloseTo(0.6, within());
      assertThat(told(effects, helper))
          .extracting(Notice::kind)
          .containsExactly(NoticeKind.KILL_ASSIST);
      assertThat(told(effects, helper).getFirst().values()).containsEntry("share", "0.6");
      assertThat(told(effects, victim)).extracting(Notice::kind).contains(NoticeKind.KILLER_HEALTH);
      var death = only(effects, MatchEffect.Death.class).getFirst();
      assertThat(death.attribution().killer()).contains(killer);
      assertThat(death.attribution().assists()).containsOnlyKeys(helper);
      assertThat(death.attribution().weapon()).contains("IRON_SWORD");
      var notice =
          effects.stream()
              .filter(MatchEffect.Announce.class::isInstance)
              .map(effect -> ((MatchEffect.Announce) effect).notice())
              .filter(n -> n.kind() == NoticeKind.DEATH)
              .findFirst()
              .orElseThrow();
      assertThat(notice.values()).containsEntry("template", AttackType.MELEE.deathMessage());
      assertThat(notice.values()).containsEntry("killedTeam", "RED");
      assertThat(notice.values()).containsEntry("killerTeam", "BLUE");
    }

    @Test
    void aKillerWhoDidAlmostNothingStoleTheKill() {
      var play = live();
      var victim = play.anyOn(TeamColor.RED).id();
      var enemies = play.on(TeamColor.BLUE).stream().map(Combatant::id).toList();
      play.hurt(victim, enemies.get(1), 19, 20);
      play.hurt(victim, enemies.get(0), 1, 1);

      var effects = play.died(victim, Optional.of(enemies.get(0)));

      assertThat(told(effects, enemies.get(0)))
          .extracting(Notice::kind)
          .contains(NoticeKind.STOLEN_KILL);
    }

    @Test
    void aFallAfterAHitIsCreditedToTheLastAttacker() {
      var play = live();
      var victim = play.anyOn(TeamColor.RED).id();
      var attacker = play.anyOn(TeamColor.BLUE).id();
      play.hurt(victim, attacker, 4, 20);

      play.ok(new MatchEvent.Died(victim, Optional.empty(), AttackType.FALL, play.now));

      assertThat(play.member(attacker).score().kills()).isEqualTo(1);
    }

    @Test
    void healedHitsAreForgottenAfterTheMemory() {
      var play = live();
      var victim = play.anyOn(TeamColor.RED).id();
      var attacker = play.anyOn(TeamColor.BLUE).id();
      play.hurt(victim, attacker, 4, 20);
      play.now = play.now.plusSeconds(11);
      // Healed back to full, then hurt by the world: the old hit is gone.
      play.ok(
          new MatchEvent.Damaged(
              victim, Optional.empty(), 2, 20, 20, AttackType.FIRE_TICK, play.now));

      assertThat(play.match.damage().lastAttack(victim)).isEmpty();
    }

    @Test
    void aBombKillGoesToTheLastAttackerWithoutADeathMessage() {
      var play = new Play();
      play.start(HARBOUR, ALICE, BOB);
      var red = play.anyOn(TeamColor.RED).id();
      var blue = play.anyOn(TeamColor.BLUE).id();
      play.hurt(blue, red, 3, 20);
      play.click(red, "blue-1");
      play.tick(1);

      var effects = new ArrayList<MatchEffect>();
      for (var i = 0; i < 70 && play.match.phase() instanceof Phase.Live; i++) {
        // Blue keeps getting hit, so the hit is never forgotten before the bomb goes off.
        play.hurt(blue, red, 1, 20);
        effects.addAll(play.tick(1));
      }

      assertThat(only(effects, MatchEffect.Death.class))
          .singleElement()
          .satisfies(death -> assertThat(death.attribution().killer()).contains(red));
      assertThat(notices(effects)).doesNotContain(NoticeKind.DEATH);
    }

    private static org.assertj.core.data.Offset<Double> within() {
      return org.assertj.core.data.Offset.offset(1e-9);
    }
  }

  @Nested
  final class Teams {

    @Test
    void medicsAreSpreadBeforeEveryoneElseAndPinnedPlayersKeepTheirTeam() {
      var seats =
          List.of(
              new TeamBalancer.Seat(ALICE, Optional.of("medic"), Optional.empty()),
              new TeamBalancer.Seat(BOB, Optional.of("medic"), Optional.empty()),
              new TeamBalancer.Seat(CAROL, Optional.empty(), Optional.of(TeamColor.RED)),
              new TeamBalancer.Seat(DAVE, Optional.empty(), Optional.empty()));
      var teams = List.of(TeamColor.RED, TeamColor.BLUE);

      var assignment =
          TeamBalancer.assign(
              seats, teams, java.util.Set.of("medic"), new java.util.SplittableRandom(3));

      assertThat(assignment.get(ALICE)).isNotEqualTo(assignment.get(BOB));
      assertThat(assignment.get(CAROL)).isEqualTo(TeamColor.RED);
      assertThat(TeamBalancer.balanced(assignment, teams)).isTrue();
    }

    @Test
    void anOperatorPlacesAMemberOnATeamBeforeTheyAreDealt() {
      var play = new Play();
      play.join(ALICE);
      play.join(BOB);
      play.ballot(HARBOUR);
      play.ok(new MatchEvent.AssignTeam(ALICE, TeamColor.BLUE));
      play.ok(new MatchEvent.AssignTeam(BOB, TeamColor.BLUE));
      play.ok(new MatchEvent.ForceStart(play.now));
      play.ready(HARBOUR);

      assertThat(play.teamOf(ALICE)).isEqualTo(TeamColor.BLUE);
      assertThat(play.teamOf(BOB)).isEqualTo(TeamColor.BLUE);
    }
  }
}
