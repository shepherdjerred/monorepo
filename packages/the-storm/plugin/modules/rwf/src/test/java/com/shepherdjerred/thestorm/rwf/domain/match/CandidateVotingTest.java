package com.shepherdjerred.thestorm.rwf.domain.match;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwf.domain.lobby.LobbyStatus;
import com.shepherdjerred.thestorm.rwf.testing.Samples;
import java.time.Duration;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;

class CandidateVotingTest {
  private static final List<Ballot.Candidate> CANDIDATES =
      List.of(
          new Ballot.Candidate("harbour", "Harbour", "Builders"),
          new Ballot.Candidate("canyon", "Canyon", "Builders"));

  private static Play open() {
    var play = new Play(Play.FLOW, Samples.T0);
    play.ok(new MatchEvent.BallotOpened(CANDIDATES, Optional.of(Duration.ofSeconds(90))));
    return play;
  }

  @Test
  void terrainReadinessDoesNotSelectTheMatchOrShortenTheVotingOpportunity() {
    var play = open();
    play.join(Samples.ALICE);
    play.join(Samples.BOB);
    play.tick(120);
    assertThat(play.match.phase()).isInstanceOf(Phase.Lobby.class);
    assertThat(LobbyStatus.of(play.match, play.now).stage())
        .isEqualTo(LobbyStatus.Stage.CANDIDATES);
    assertThat(play.ok(new MatchEvent.CandidatesReady(List.of("harbour", "canyon"), play.now)))
        .isEmpty();
    assertThat(play.match.map()).isEmpty();
    assertThat(play.match.ballot().orElseThrow().closed()).isFalse();
    play.tick(89);
    assertThat(LobbyStatus.of(play.match, play.now).secondsLeft()).isEqualTo(1);
    play.ok(new MatchEvent.Vote(Samples.ALICE, "harbour"));
    var effects = play.tick(1);
    assertThat(effects).contains(new MatchEffect.PrepareMap("harbour"));
    var countdown = (Phase.Countdown) play.match.phase();
    assertThat(Duration.between(play.now, countdown.startsAt())).isEqualTo(Duration.ofSeconds(20));
    assertThat(play.match.map()).isEmpty();
  }

  @Test
  void aReadyBallotWithNoPlayersGrantsNinetySecondsFromTheFirstArrival() {
    var play = open();
    play.ok(new MatchEvent.CandidatesReady(List.of("harbour", "canyon"), play.now));
    play.tick(200);
    play.join(Samples.ALICE);
    play.tick(1);
    play.tick(89);
    assertThat(play.match.ballot().orElseThrow().closed()).isFalse();
    play.tick(1);
    assertThat(play.match.ballot().orElseThrow().closed()).isTrue();
    assertThat(play.match.phase()).isInstanceOf(Phase.Lobby.class);
  }

  @Test
  void aSoloPlayerClosesTheVoteForBotDraftingButStillNeedsAPlayablePopulation() {
    var play = open();
    play.join(Samples.ALICE);
    play.tick(1);
    play.ok(new MatchEvent.CandidatesReady(List.of("harbour", "canyon"), play.now));
    play.ok(new MatchEvent.Vote(Samples.ALICE, "harbour"));
    play.tick(90);
    play.ready(Samples.twoTeams());
    play.tick(40);
    assertThat(play.match.phase()).isInstanceOf(Phase.Lobby.class);
    play.join(Samples.BOT_1);
    play.tick(1);
    assertThat(play.match.phase()).isInstanceOf(Phase.Countdown.class);
    play.tick(20);
    assertThat(play.match.phase()).isInstanceOf(Phase.Preview.class);
  }

  @Test
  void readinessForAnotherBallotAndLateReadinessAfterStoppingAreRejected() {
    var play = open();
    assertThat(play.refused(new MatchEvent.CandidatesReady(List.of("canyon", "harbour"), play.now)))
        .isEqualTo(MatchError.MAP_LOCKED);
    play.ok(new MatchEvent.Stop());
    assertThat(play.refused(new MatchEvent.CandidatesReady(List.of("harbour", "canyon"), play.now)))
        .isEqualTo(MatchError.MAP_LOCKED);
  }
}
