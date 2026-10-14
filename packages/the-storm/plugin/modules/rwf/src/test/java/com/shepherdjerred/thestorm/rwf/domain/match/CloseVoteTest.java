package com.shepherdjerred.thestorm.rwf.domain.match;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwf.testing.Samples;
import java.util.List;
import org.junit.jupiter.api.Test;

final class CloseVoteTest {
  private static final List<Ballot.Candidate> CANDIDATES =
      List.of(
          new Ballot.Candidate("one", "One", "Author"),
          new Ballot.Candidate("two", "Two", "Author"),
          new Ballot.Candidate("three", "Three", "Author"));

  @Test
  void anEmptyShowcaseVoteUsesTheNormalSeededChoiceAndPreparesOnlyTheWinner() {
    var showcase = new Play();
    showcase.ok(new MatchEvent.BallotOpened(CANDIDATES));
    var effects = showcase.ok(new MatchEvent.CloseVote());
    var chosen = showcase.match.ballot().orElseThrow().chosen().orElseThrow();

    var ordinary = new Play();
    ordinary.ok(new MatchEvent.BallotOpened(CANDIDATES));
    ordinary.join(Samples.ALICE);
    ordinary.join(Samples.BOB);
    ordinary.ok(new MatchEvent.ForceStart(ordinary.now));

    assertThat(ordinary.match.ballot().orElseThrow().chosen()).contains(chosen);
    assertThat(effects.stream().filter(MatchEffect.PrepareMap.class::isInstance))
        .containsExactly(new MatchEffect.PrepareMap(chosen));
    assertThat(showcase.match.members()).isEmpty();
    assertThat(showcase.match.map()).isEmpty();
    assertThat(showcase.ok(new MatchEvent.CloseVote())).isEmpty();
  }

  @Test
  void closingCannotInventABallotOrChangeAResettingMatch() {
    var play = new Play();
    assertThat(play.refused(new MatchEvent.CloseVote())).isEqualTo(MatchError.NO_BALLOT);
    play.ok(new MatchEvent.BallotOpened(CANDIDATES));
    play.ok(new MatchEvent.Stop());
    assertThat(play.refused(new MatchEvent.CloseVote())).isEqualTo(MatchError.NOT_PRE_GAME);
  }
}
