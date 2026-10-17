package com.shepherdjerred.thestorm.e2e.maps;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.match.Ballot;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchSnapshot;
import com.shepherdjerred.thestorm.rwf.domain.match.Score;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;

final class CandidateReadinessTest {
  private static final String MAP = "apex-expanse";
  private static final Ballot.Candidate CANDIDATE = new Ballot.Candidate(MAP, "Apex", "Author");
  private static final Ballot READY =
      new Ballot(
          List.of(CANDIDATE),
          Map.of(),
          Optional.empty(),
          Optional.of(new Ballot.Visits(Duration.ofSeconds(90), Optional.of(Instant.EPOCH))));

  @Test
  void requiresCompletedCandidateVisitsEvenWhenLobbyAdmitsPlayers() {
    var loading =
        new Ballot(
            READY.candidates(),
            Map.of(),
            Optional.empty(),
            Optional.of(new Ballot.Visits(Duration.ofSeconds(90), Optional.empty())));
    assertFalse(ready(loading));
    assertFalse(ready(Ballot.open(List.of(CANDIDATE))));
    assertTrue(ready(READY));
    assertFalse(READY.closed());
  }

  @Test
  void requiresExactlyTheRequestedCandidateAndAnUnclosedBallot() {
    assertFalse(CandidateReadiness.ready(snapshot(READY, List.of()), "another-map"));
    assertFalse(ready(Ballot.NONE));
    assertFalse(
        ready(
            new Ballot(
                List.of(CANDIDATE, new Ballot.Candidate("other", "Other", "Author")),
                Map.of(),
                Optional.empty(),
                READY.visits())));
    assertFalse(ready(new Ballot(READY.candidates(), Map.of(), Optional.of(MAP), READY.visits())));
  }

  @Test
  void requiresACurrentEmptyLobbyRatherThanAnotherPhaseOrPopulatedLobby() {
    assertFalse(CandidateReadiness.ready(Optional.empty(), MAP));
    var member =
        new MatchSnapshot.CombatantView(
            new CombatantId.Human(UUID.randomUUID()),
            "Participant",
            Optional.empty(),
            Optional.empty(),
            true,
            false,
            Score.ZERO);
    assertFalse(CandidateReadiness.ready(snapshot(READY, List.of(member)), MAP));
    var lobby = snapshot(READY, List.of()).orElseThrow();
    for (var phase : MatchSnapshot.PhaseKind.values()) {
      if (phase == MatchSnapshot.PhaseKind.LOBBY) continue;
      var other =
          new MatchSnapshot(
              lobby.matchId(),
              phase,
              lobby.now(),
              lobby.mapId(),
              lobby.teams(),
              lobby.combatants(),
              lobby.bombs(),
              lobby.poison(),
              lobby.outcome(),
              lobby.startsAt(),
              lobby.ballot());
      assertFalse(CandidateReadiness.ready(Optional.of(other), MAP), phase.name());
    }
  }

  private static boolean ready(Ballot ballot) {
    return CandidateReadiness.ready(snapshot(ballot, List.of()), MAP);
  }

  private static Optional<MatchSnapshot> snapshot(
      Ballot ballot, List<MatchSnapshot.CombatantView> members) {
    return Optional.of(
        new MatchSnapshot(
            UUID.randomUUID(),
            MatchSnapshot.PhaseKind.LOBBY,
            Instant.EPOCH,
            Optional.empty(),
            List.of(),
            members,
            List.of(),
            Optional.empty(),
            Optional.empty(),
            Optional.empty(),
            Optional.of(ballot)));
  }
}
