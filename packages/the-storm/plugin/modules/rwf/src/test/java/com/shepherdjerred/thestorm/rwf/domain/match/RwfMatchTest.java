package com.shepherdjerred.thestorm.rwf.domain.match;

import static com.shepherdjerred.thestorm.rwf.testing.Samples.ALICE;
import static com.shepherdjerred.thestorm.rwf.testing.Samples.BOB;
import static com.shepherdjerred.thestorm.rwf.testing.Samples.CAROL;
import static com.shepherdjerred.thestorm.rwf.testing.Samples.DAVE;
import static com.shepherdjerred.thestorm.rwf.testing.Samples.T0;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwf.domain.bomb.BombState;
import com.shepherdjerred.thestorm.rwf.domain.bomb.FuseBonus;
import com.shepherdjerred.thestorm.rwf.domain.bomb.FuseType;
import com.shepherdjerred.thestorm.rwf.domain.combat.AttackType;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchEffect.Announce;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchEffect.BombArmed;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchEffect.BombRemoved;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchEffect.BombRestored;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchEffect.CaptureSnapshot;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchEffect.Crater;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchEffect.EnterLobby;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchEffect.Equip;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchEffect.GiveFuse;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchEffect.Kill;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchEffect.Pay;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchEffect.PoisonDamage;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchEffect.Restore;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchEffect.RevertCraters;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchEffect.SetTime;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchEffect.Spectate;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchEffect.StripFood;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchEffect.Teleport;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchEvent.BombClicked;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchEvent.Died;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchEvent.ForceStart;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchEvent.Join;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchEvent.Leave;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchEvent.MapChosen;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchEvent.PickKit;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchEvent.ResetDone;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchEvent.Stop;
import com.shepherdjerred.thestorm.rwf.domain.match.Phase.Countdown;
import com.shepherdjerred.thestorm.rwf.domain.match.Phase.Ended;
import com.shepherdjerred.thestorm.rwf.domain.match.Phase.Live;
import com.shepherdjerred.thestorm.rwf.domain.match.Phase.Lobby;
import com.shepherdjerred.thestorm.rwf.domain.match.Phase.Resetting;
import com.shepherdjerred.thestorm.rwf.testing.Samples;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

final class RwfMatchTest {

  private final Play play = new Play();

  private static List<NoticeKind> notices(List<MatchEffect> effects) {
    return effects.stream()
        .filter(Announce.class::isInstance)
        .map(effect -> ((Announce) effect).notice().kind())
        .toList();
  }

  private static <T extends MatchEffect> List<T> only(List<MatchEffect> effects, Class<T> type) {
    return effects.stream().filter(type::isInstance).map(type::cast).toList();
  }

  /** Ticks a second at a time, collecting every effect. */
  private static List<MatchEffect> tickFor(Play play, int seconds) {
    var effects = new ArrayList<MatchEffect>();
    for (var i = 0; i < seconds; i++) {
      effects.addAll(play.tick(1));
    }
    return effects;
  }

  @Nested
  final class Lobbying {

    @Test
    void joiningSnapshotsAndEntersTheLobby() {
      var effects = play.join(ALICE);

      assertThat(effects).startsWith(new CaptureSnapshot(ALICE), new EnterLobby(ALICE));
      assertThat(notices(effects)).containsExactly(NoticeKind.JOINED);
      assertThat(play.match.phase()).isEqualTo(Lobby.EMPTY);
      assertThat(play.member(ALICE).alive()).isFalse();
    }

    @Test
    void aCombatantCannotJoinTwice() {
      play.join(ALICE);

      assertThat(play.refused(new Join(ALICE, "Alice", play.now)))
          .isEqualTo(MatchError.ALREADY_JOINED);
    }

    @Test
    void theLobbyFillsUp() {
      var small = new Play(Play.SETTINGS.withMaxPlayers(2), T0);
      small.join(ALICE);
      small.join(BOB);

      assertThat(small.refused(new Join(CAROL, "Carol", T0))).isEqualTo(MatchError.FULL);
    }

    @Test
    void pickingAKitEquipsIt() {
      play.join(ALICE);

      var effects = play.ok(new PickKit(ALICE, "longbow"));

      assertThat(effects).contains(new Equip(ALICE, "longbow"));
      assertThat(play.member(ALICE).kit()).contains("longbow");
      assertThat(play.refused(new PickKit(ALICE, "ninja"))).isEqualTo(MatchError.UNKNOWN_KIT);
      assertThat(play.refused(new PickKit(BOB, "trooper"))).isEqualTo(MatchError.NOT_A_MEMBER);
    }

    @Test
    void leavingTheLobbyRestoresThePlayer() {
      play.join(ALICE);

      var effects = play.ok(new Leave(ALICE, play.now));

      assertThat(effects).contains(new Restore(ALICE));
      assertThat(play.match.members()).isEmpty();
      assertThat(play.refused(new Leave(ALICE, play.now))).isEqualTo(MatchError.NOT_A_MEMBER);
    }

    @Test
    void nothingStartsWithoutAMap() {
      play.join(ALICE);
      play.join(BOB);

      play.tick(1);

      assertThat(play.match.phase()).isInstanceOf(Lobby.class);
      assertThat(play.refused(new ForceStart(play.now))).isEqualTo(MatchError.NO_MAP);
    }

    @Test
    void enoughPlayersAndAMapStartTheCountdown() {
      play.join(ALICE);
      play.join(BOB);
      play.ok(new MapChosen(Samples.twoTeams()));

      var effects = play.tick(1);

      assertThat(play.match.phase())
          .isEqualTo(new Countdown(play.now.plusSeconds(90), play.now, 90));
      assertThat(notices(effects)).containsExactly(NoticeKind.COUNTDOWN);
    }

    @Test
    void thePlayerRequirementRelaxesWhileTheLobbyWaits() {
      var waiting = new Play(MatchSettings.RED_WARFARE, T0);
      waiting.join(ALICE);
      waiting.join(BOB);
      waiting.ok(new MapChosen(Samples.twoTeams()));

      waiting.tick(0);
      assertThat(waiting.match.phase()).isInstanceOf(Lobby.class);
      waiting.tick(15);
      assertThat(waiting.match.phase()).isInstanceOf(Lobby.class);
      waiting.tick(15);
      assertThat(waiting.match.phase()).isInstanceOf(Countdown.class);
    }

    @Test
    void theCountdownStopsWhenPlayersLeave() {
      play.join(ALICE);
      play.join(BOB);
      play.ok(new MapChosen(Samples.twoTeams()));
      play.tick(1);
      play.ok(new Leave(BOB, play.now));

      var effects = play.tick(1);

      assertThat(play.match.phase()).isInstanceOf(Lobby.class);
      assertThat(notices(effects)).containsExactly(NoticeKind.COUNTDOWN_CANCELLED);
    }

    @Test
    void theCountdownAnnouncesItsWayToLive() {
      play.join(ALICE);
      play.join(BOB);
      play.ok(new MapChosen(Samples.twoTeams()));
      play.tick(1);

      var effects = tickFor(play, 90);

      var seconds =
          effects.stream()
              .filter(Announce.class::isInstance)
              .map(effect -> ((Announce) effect).notice())
              .filter(notice -> notice.kind() == NoticeKind.COUNTDOWN)
              .map(notice -> notice.values().get("seconds"))
              .toList();
      assertThat(seconds).containsExactly("30", "15", "10", "5", "4", "3", "2", "1");
      assertThat(play.match.phase()).isInstanceOf(Live.class);
    }

    @Test
    void forceStartNeedsTwoPlayers() {
      play.join(ALICE);
      play.ok(new MapChosen(Samples.twoTeams()));

      assertThat(play.refused(new ForceStart(play.now))).isEqualTo(MatchError.TOO_FEW_PLAYERS);
    }
  }

  @Nested
  final class Starting {

    @Test
    void goingLiveBalancesTeamsEquipsAndPlaces() {
      play.join(ALICE);
      play.ok(new PickKit(ALICE, "longbow"));
      var effects = play.start(Samples.twoTeams(), BOB, CAROL, DAVE);

      assertThat(play.match.phase()).isInstanceOf(Live.class);
      assertThat(play.on(TeamColor.RED)).hasSize(2);
      assertThat(play.on(TeamColor.BLUE)).hasSize(2);
      assertThat(play.match.members()).allMatch(Combatant::alive);
      assertThat(only(effects, Equip.class))
          .contains(new Equip(ALICE, "longbow"), new Equip(BOB, "trooper"));
      assertThat(only(effects, Teleport.class)).hasSize(4);
      assertThat(only(effects, SetTime.class))
          .containsExactly(new SetTime(play.match.night() ? 15000 : 0));
      assertThat(notices(effects))
          .contains(NoticeKind.GAME_BEGUN, NoticeKind.TEAM_SIZE, NoticeKind.TEAM_SIZE);
      assertThat(play.match.bombs()).hasSize(2);
      assertThat(play.match.bombs()).allMatch(bomb -> bomb.state() instanceof BombState.Idle);
    }

    @Test
    void oneMatchInFiveIsAtNight() {
      var nights = IntStream.range(0, 1000).filter(seed -> Flow.night(seed)).count();

      assertThat(nights).isBetween(150L, 250L);
    }

    @Test
    void aLoneTeamMemberIsLastManStandingFromTheStart() {
      var effects = play.start(Samples.twoTeams(), ALICE, BOB);

      assertThat(only(effects, GiveFuse.class))
          .containsExactlyInAnyOrder(
              new GiveFuse(ALICE, Standings.LAST_MAN_FUSE),
              new GiveFuse(BOB, Standings.LAST_MAN_FUSE));
      assertThat(play.member(ALICE).fuse())
          .contains(new FuseBonus(FuseType.BOMB_ARMING, FuseBonus.INSTANT));
      assertThat(notices(effects))
          .containsSubsequence(NoticeKind.LAST_MAN_STANDING, NoticeKind.LAST_MAN_STANDING);
    }

    @Test
    void theMapIsLockedAndNobodyJoinsOnceLive() {
      play.start(Samples.twoTeams(), ALICE, BOB);

      assertThat(play.refused(new MapChosen(Samples.threeTeams())))
          .isEqualTo(MatchError.MAP_LOCKED);
      assertThat(play.refused(new Join(CAROL, "Carol", play.now)))
          .isEqualTo(MatchError.IN_PROGRESS);
      assertThat(play.refused(new PickKit(ALICE, "longbow"))).isEqualTo(MatchError.NOT_PRE_GAME);
      assertThat(play.refused(new ForceStart(play.now))).isEqualTo(MatchError.NOT_PRE_GAME);
    }
  }

  @Nested
  final class Dying {

    @Test
    void aDeathMakesASpectatorAndCreditsTheKiller() {
      play.start(Samples.twoTeams(), ALICE, BOB, CAROL, DAVE);
      var red = play.anyOn(TeamColor.RED);
      var blue = play.anyOn(TeamColor.BLUE);

      var effects = play.died(red.id(), Optional.of(blue.id()));

      assertThat(effects)
          .contains(
              new Spectate(red.id(), Samples.twoTeams().spectatorPoint()),
              new MatchEffect.RecordStat(blue.id(), "Kills"));
      assertThat(play.member(red.id()).alive()).isFalse();
      assertThat(play.match.phase()).isInstanceOf(Live.class);
      assertThat(play.died(red.id(), Optional.empty())).isEmpty();
    }

    @Test
    void theLastTeamAliveWinsAndIsPaid() {
      play.start(Samples.twoTeams(), ALICE, BOB, CAROL, DAVE);
      tickFor(play, 61);
      var reds = play.on(TeamColor.RED);
      play.died(reds.get(0).id(), Optional.empty());

      var effects = play.died(reds.get(1).id(), Optional.empty());

      assertThat(notices(effects))
          .containsSubsequence(NoticeKind.TEAM_DEFEATED, NoticeKind.TEAM_WINS);
      assertThat(effects).contains(new BombRemoved("red-1"));
      assertThat(play.match.phase())
          .isEqualTo(new Ended(play.now, new Outcome.Winner(TeamColor.BLUE)));
      var pays = only(effects, Pay.class);
      assertThat(pays).hasSize(4);
      for (var blue : play.on(TeamColor.BLUE)) {
        assertThat(pays).contains(new Pay(blue.id(), 3, "WIN"));
      }
      for (var red : reds) {
        assertThat(pays).contains(new Pay(red.id(), 1, "LOSE"));
      }
    }

    @Test
    void aShortMatchPaysNobody() {
      play.start(Samples.twoTeams(), ALICE, BOB);

      var effects = play.died(ALICE, Optional.empty());

      assertThat(only(effects, Pay.class)).isEmpty();
      assertThat(play.match.phase()).isInstanceOf(Ended.class);
    }

    @Test
    void anEarlySuicideForfeitsRewards() {
      play.start(Samples.twoTeams(), ALICE, BOB, CAROL, DAVE);
      var red = play.anyOn(TeamColor.RED);
      play.ok(new Died(red.id(), Optional.empty(), AttackType.SUICIDE, play.now));
      tickFor(play, 61);
      var other = play.anyOn(TeamColor.RED);

      var effects = play.died(other.id(), Optional.empty());

      assertThat(only(effects, Pay.class)).doesNotContain(new Pay(red.id(), 1, "LOSE"));
      assertThat(only(effects, Pay.class)).contains(new Pay(other.id(), 1, "LOSE"));
    }

    @Test
    void leavingMidMatchCountsAsFalling() {
      play.start(Samples.twoTeams(), ALICE, BOB);

      var effects = play.ok(new Leave(ALICE, play.now));

      assertThat(effects).contains(new Restore(ALICE));
      assertThat(notices(effects))
          .containsSubsequence(NoticeKind.LEFT, NoticeKind.TEAM_DEFEATED, NoticeKind.TEAM_WINS);
      assertThat(play.match.departed()).extracting(Combatant::id).containsExactly(ALICE);
    }
  }

  @Nested
  final class Bombing {

    private void clickFor(CombatantId who, String bomb, double seconds) {
      for (var i = 0; i < seconds * 2; i++) {
        play.click(who, bomb);
        play.tickMillis(500);
      }
    }

    @Test
    void nobodyArmsTheirOwnBomb() {
      play.start(Samples.twoTeams(), ALICE, BOB, CAROL, DAVE);
      var red = play.anyOn(TeamColor.RED);

      assertThat(play.refused(new BombClicked(red.id(), "red-1", play.now)))
          .isEqualTo(MatchError.CANNOT_ARM_OWN_BOMB);
      assertThat(play.refused(new BombClicked(red.id(), "nope", play.now)))
          .isEqualTo(MatchError.UNKNOWN_BOMB);
    }

    @Test
    void anEnemyArmsTheBombByClickingForNineSeconds() {
      play.start(Samples.twoTeams(), ALICE, BOB, CAROL, DAVE);
      var blue = play.anyOn(TeamColor.BLUE);

      play.click(blue.id(), "red-1");
      var snapshot = MatchSnapshot.of(play.match, play.now);
      assertThat(snapshot.bomb("red-1").orElseThrow().state())
          .isEqualTo(
              new MatchSnapshot.BombView.State.Arming(TeamColor.BLUE, 0, List.of(blue.id())));

      clickFor(blue.id(), "red-1", 9.5);

      assertThat(play.match.bomb("red-1").orElseThrow().armed()).isTrue();
      var red = play.anyOn(TeamColor.RED);
      assertThat(play.refused(new BombClicked(blue.id(), "red-1", play.now)))
          .isEqualTo(MatchError.CANNOT_DEFUSE_ENEMY_BOMB);
      play.click(red.id(), "red-1");
    }

    @Test
    void anExplodedBombWipesItsOwners() {
      play.start(Samples.twoTeams(), ALICE, BOB, CAROL, DAVE);
      var blue = play.anyOn(TeamColor.BLUE);
      clickFor(blue.id(), "red-1", 9.5);
      var armedAt = play.now;

      var effects = tickFor(play, 60);

      assertThat(only(effects, Kill.class))
          .containsExactly(
              new Kill(
                  play.on(TeamColor.RED).stream().map(Combatant::id).toList(),
                  AttackType.BOMB_EXPLODE));
      assertThat(effects).contains(new Crater(Samples.RED_BOMB, 6), new BombRemoved("red-1"));
      assertThat(notices(effects))
          .containsSubsequence(
              NoticeKind.BOMB_EXPLODED, NoticeKind.TEAM_DEFEATED, NoticeKind.TEAM_WINS);
      assertThat(play.match.phase()).isInstanceOf(Ended.class);
      assertThat(((Ended) play.match.phase()).at()).isAfter(armedAt.plusSeconds(59));
    }

    @Test
    void theLastManArmsInstantly() {
      play.start(Samples.twoTeams(), ALICE, BOB);

      var effects = play.click(ALICE, play.enemyBomb(ALICE));

      assertThat(effects).contains(new BombArmed(play.enemyBomb(ALICE)));
      assertThat(notices(effects)).contains(NoticeKind.BOMB_ARMED);
    }

    @Test
    void bombsFallingTogetherDrawTheMatch() {
      play.start(Samples.twoTeams(), ALICE, BOB);
      play.click(ALICE, play.enemyBomb(ALICE));
      play.click(BOB, play.enemyBomb(BOB));

      var effects = tickFor(play, 60);

      assertThat(only(effects, Kill.class)).hasSize(2);
      assertThat(play.match.phase()).isEqualTo(new Ended(play.now, new Outcome.Draw()));
      assertThat(notices(effects)).contains(NoticeKind.DRAW);
    }

    @Test
    void anyoneArmsANukeAndOnlyOthersMayDefuseIt() {
      play.start(Samples.twoTeamsWithNuke(), ALICE, BOB, CAROL, DAVE);
      var red = play.anyOn(TeamColor.RED);
      var blue = play.anyOn(TeamColor.BLUE);

      clickFor(red.id(), "nuke-1", 9.5);

      assertThat(play.match.bomb("nuke-1").orElseThrow().team()).contains(TeamColor.RED);
      assertThat(play.refused(new BombClicked(red.id(), "nuke-1", play.now)))
          .isEqualTo(MatchError.CANNOT_DEFUSE_OWN_NUKE);
      play.click(blue.id(), "nuke-1");
    }

    @Test
    void aNukeAnnihilatesEveryoneElseAndTakesTheArmersBombsWithIt() {
      play.start(Samples.twoTeamsWithNuke(), ALICE, BOB, CAROL, DAVE);
      var red = play.anyOn(TeamColor.RED);
      clickFor(red.id(), "nuke-1", 9.5);

      var effects = tickFor(play, 60);

      assertThat(only(effects, Kill.class))
          .containsExactly(
              new Kill(
                  play.on(TeamColor.BLUE).stream().map(Combatant::id).toList(),
                  AttackType.BOMB_EXPLODE));
      assertThat(effects)
          .contains(new BombRemoved("nuke-1"), new BombRemoved("red-1"), new BombRemoved("blue-1"));
      assertThat(notices(effects)).contains(NoticeKind.NUKE_EXPLODED);
      assertThat(play.match.phase())
          .isEqualTo(new Ended(play.now, new Outcome.Winner(TeamColor.RED)));
    }

    @Test
    void aDefeatedTeamsArmedNukeIsRestored() {
      play.start(Samples.twoTeamsWithNuke(), ALICE, BOB, CAROL, DAVE);
      var reds = play.on(TeamColor.RED);
      clickFor(reds.get(0).id(), "nuke-1", 9.5);
      play.died(reds.get(0).id(), Optional.empty());

      var effects = play.died(reds.get(1).id(), Optional.empty());

      assertThat(effects).contains(new BombRestored("nuke-1"), new BombRemoved("red-1"));
      assertThat(play.match.bomb("nuke-1").orElseThrow().team()).isEmpty();
      assertThat(play.match.bomb("nuke-1").orElseThrow().armed()).isFalse();
    }

    @Test
    void theDeadCannotClickAndNobodyClicksBeforeLive() {
      play.join(ALICE);
      assertThat(play.refused(new BombClicked(ALICE, "red-1", play.now)))
          .isEqualTo(MatchError.NOT_LIVE);
      play.start(Samples.twoTeams(), BOB, CAROL, DAVE);
      var red = play.anyOn(TeamColor.RED);
      play.died(red.id(), Optional.empty());

      assertThat(play.refused(new BombClicked(red.id(), "blue-1", play.now)))
          .isEqualTo(MatchError.NOT_ALIVE);
    }
  }

  @Nested
  final class Poisoning {

    @Test
    void aQuietMatchIsWarnedThenPoisoned() {
      play.start(Samples.twoTeams(), ALICE, BOB, CAROL, DAVE);

      var untilWarning = tickFor(play, 218);
      assertThat(notices(untilWarning)).containsOnlyOnce(NoticeKind.POISON_WARNING);
      assertThat(notices(untilWarning)).doesNotContain(NoticeKind.POISON_BEGUN);

      var untilDeadly = tickFor(play, 61);
      assertThat(notices(untilDeadly)).containsOnlyOnce(NoticeKind.POISON_BEGUN);
      assertThat(only(untilDeadly, StripFood.class)).hasSize(1);
      assertThat(only(untilDeadly, PoisonDamage.class)).hasSize(4);
      assertThat(only(untilDeadly, PoisonDamage.class)).allMatch(damage -> damage.amount() >= 0.75);
    }
  }

  @Nested
  final class Resets {

    @Test
    void theEndScreenGivesWayToAResetAndThenAFreshLobby() {
      play.start(Samples.twoTeams(), ALICE, BOB);
      play.died(ALICE, Optional.empty());

      var effects = play.tick(15);

      assertThat(effects).contains(new Restore(ALICE), new Restore(BOB), new RevertCraters());
      assertThat(play.match.phase()).isEqualTo(new Resetting());
      assertThat(play.match.members()).isEmpty();
      assertThat(play.refused(new Stop())).isEqualTo(MatchError.ALREADY_RESETTING);

      play.ok(new ResetDone());

      assertThat(play.match.phase()).isEqualTo(Lobby.EMPTY);
      assertThat(play.match.map()).isEmpty();
      play.join(ALICE);
    }

    @Test
    void stoppingALiveMatchRestoresEveryone() {
      play.start(Samples.twoTeams(), ALICE, BOB);

      var effects = play.ok(new Stop());

      assertThat(notices(effects)).containsExactly(NoticeKind.STOPPED);
      assertThat(effects).contains(new Restore(ALICE), new Restore(BOB), new RevertCraters());
      assertThat(play.match.phase()).isEqualTo(new Resetting());
      play.ok(new ResetDone());
    }

    @Test
    void resetDoneNeedsAReset() {
      assertThat(play.refused(new ResetDone())).isEqualTo(MatchError.NOT_RESETTING);
    }
  }

  @Nested
  final class Snapshots {

    @Test
    void aSnapshotShowsTheMatchAsItStands() {
      play.start(Samples.twoTeams(), ALICE, BOB, CAROL, DAVE);

      var snapshot = MatchSnapshot.of(play.match, play.now);

      assertThat(snapshot.phase()).isEqualTo(MatchSnapshot.PhaseKind.LIVE);
      assertThat(snapshot.mapId()).contains("harbour");
      assertThat(snapshot.teams()).containsExactly(TeamColor.RED, TeamColor.BLUE);
      assertThat(snapshot.combatants()).hasSize(4).allMatch(MatchSnapshot.CombatantView::alive);
      var alice = snapshot.combatant(ALICE).orElseThrow();
      assertThat(alice.apparentTeam(BOB)).isEqualTo(alice.team());
      assertThat(snapshot.bombs()).hasSize(2);
      assertThat(snapshot.bomb("red-1").orElseThrow().team()).contains(TeamColor.RED);
      assertThat(snapshot.bomb("red-1").orElseThrow().state())
          .isEqualTo(new MatchSnapshot.BombView.State.Idle());
      assertThat(snapshot.poison()).isPresent();
      assertThat(snapshot.outcome()).isEmpty();
    }
  }
}
