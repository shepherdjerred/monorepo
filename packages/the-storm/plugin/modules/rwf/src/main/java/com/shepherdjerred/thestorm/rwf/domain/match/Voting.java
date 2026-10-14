package com.shepherdjerred.thestorm.rwf.domain.match;

import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.SplittableRandom;
import java.util.stream.Collectors;

/** The lobby's map vote: opening it, votes, closing it, an operator's choice and a failed load. */
final class Voting {

  /** Mixed into the seed for the vote's tie-break, so it differs from the other rolls. */
  private static final long BALLOT_SALT = 0x62616c6c6f74L;

  private Voting() {}

  static Optional<MatchError> opened(
      Draft draft, List<Ballot.Candidate> candidates, Optional<Duration> visitLength) {
    if (!(draft.phase instanceof Phase.Lobby) && !(draft.phase instanceof Phase.Countdown)) {
      return Optional.of(MatchError.NOT_PRE_GAME);
    }
    if (candidates.isEmpty()) {
      return Optional.of(MatchError.NO_MAP);
    }
    if (draft.ballot().filter(Ballot::opened).isPresent()) {
      return Optional.of(MatchError.BALLOT_ALREADY_OPEN);
    }
    draft.ballot(Ballot.open(candidates, visitLength));
    if (candidates.size() == 1 && visitLength.isEmpty()) {
      // Nothing to vote on: the one map is chosen and starts loading at once.
      close(draft);
    } else {
      draft.announce(
          Notice.of(
              NoticeKind.BALLOT_OPEN,
              "maps",
              candidates.stream().map(Ballot.Candidate::name).collect(Collectors.joining(", "))));
    }
    return Optional.empty();
  }

  static Optional<MatchError> visitsReady(Draft draft, List<String> mapIds, Instant now) {
    var current = draft.ballot();
    if (current.isEmpty()) return Optional.of(MatchError.MAP_LOCKED);
    var ballot = current.orElseThrow();
    if (ballot.closed()
        || ballot.visits().isEmpty()
        || !ballot.candidates().stream().map(Ballot.Candidate::mapId).toList().equals(mapIds)) {
      return Optional.of(MatchError.MAP_LOCKED);
    }
    if (ballot.visits().orElseThrow().readyAt().isEmpty()) {
      draft.ballot(ballot.visitsReady(now));
    }
    return Optional.empty();
  }

  static Optional<MatchError> cast(Draft draft, CombatantId voter, String mapId) {
    var member = draft.member(voter);
    if (member.isEmpty()) {
      return Optional.of(MatchError.NOT_A_MEMBER);
    }
    var ballot = draft.ballot().filter(Ballot::opened);
    if (ballot.isEmpty()) {
      return Optional.of(MatchError.NO_BALLOT);
    }
    if (ballot.orElseThrow().closed()) {
      return Optional.of(MatchError.VOTE_CLOSED);
    }
    var candidate = ballot.orElseThrow().candidate(mapId);
    if (candidate.isEmpty()) {
      return Optional.of(MatchError.NOT_ON_BALLOT);
    }
    draft.ballot(ballot.orElseThrow().vote(voter, mapId));
    draft.tell(voter, Notice.of(NoticeKind.VOTED, "map", candidate.orElseThrow().name()));
    return Optional.empty();
  }

  /** A member left before the vote closed: their vote goes with them. */
  static void withdraw(Draft draft, CombatantId voter) {
    draft
        .ballot()
        .filter(ballot -> !ballot.closed())
        .ifPresent(ballot -> draft.ballot(ballot.withdraw(voter)));
  }

  /** The vote closes now: the winner is announced and loaded. */
  static Optional<MatchError> closeVote(Draft draft) {
    if (!(draft.phase instanceof Phase.Lobby) && !(draft.phase instanceof Phase.Countdown)) {
      return Optional.of(MatchError.NOT_PRE_GAME);
    }
    if (draft.ballot().filter(Ballot::opened).isEmpty()) {
      return Optional.of(MatchError.NO_BALLOT);
    }
    close(draft);
    return Optional.empty();
  }

  /** The vote closes now: the winner is announced and loaded. */
  static void close(Draft draft) {
    var ballot = draft.ballot().orElseThrow();
    if (ballot.closed()) {
      return;
    }
    var closed = closed(draft, ballot);
    draft.ballot(closed);
    announceChoice(draft, closed);
  }

  /** The ballot closed with the seeded tie-break; each retry after a failed map rolls afresh. */
  private static Ballot closed(Draft draft, Ballot ballot) {
    return ballot.close(
        new SplittableRandom(draft.seed ^ BALLOT_SALT ^ ballot.candidates().size()));
  }

  private static void announceChoice(Draft draft, Ballot closed) {
    var chosen = closed.candidate(closed.chosen().orElseThrow()).orElseThrow();
    if (closed.candidates().size() > 1) {
      draft.announce(
          Notice.of(
              NoticeKind.MAP_CHOSEN,
              Map.of(
                  "map",
                  chosen.name(),
                  "author",
                  chosen.author(),
                  "votes",
                  String.valueOf(closed.count(chosen.mapId())))));
    }
    if (draft.map.filter(map -> map.id().equals(chosen.mapId())).isEmpty()) {
      draft.map = Optional.empty();
      draft.effect(new MatchEffect.PrepareMap(chosen.mapId()));
    }
  }

  static Optional<MatchError> set(Draft draft, Ballot.Candidate candidate) {
    if (!(draft.phase instanceof Phase.Lobby) && !(draft.phase instanceof Phase.Countdown)) {
      return Optional.of(MatchError.MAP_LOCKED);
    }
    var forced = Ballot.forced(candidate);
    draft.ballot(forced);
    announceChoice(draft, forced);
    return Optional.empty();
  }

  /**
   * The chosen map could not be prepared: it leaves the ballot and, if any map is left, the vote
   * closes again on the rest; with none left the lobby asks for a fresh ballot.
   */
  static Optional<MatchError> failed(Draft draft, String mapId) {
    var ballot = draft.ballot();
    if (ballot.isEmpty() || ballot.orElseThrow().chosen().filter(mapId::equals).isEmpty()) {
      return Optional.empty();
    }
    var name = ballot.orElseThrow().candidate(mapId).map(Ballot.Candidate::name).orElse(mapId);
    draft.announce(Notice.of(NoticeKind.MAP_FAILED, "map", name));
    remove(draft, ballot.orElseThrow(), mapId);
    return Optional.empty();
  }

  /** Removes an operator-quarantined candidate and its votes before the match starts. */
  static Optional<MatchError> quarantined(Draft draft, String mapId) {
    var ballot = draft.ballot();
    if (ballot.isEmpty() || ballot.orElseThrow().candidate(mapId).isEmpty()) {
      return Optional.empty();
    }
    remove(draft, ballot.orElseThrow(), mapId);
    return Optional.empty();
  }

  private static void remove(Draft draft, Ballot ballot, String mapId) {
    var left = ballot.without(mapId);
    if (ballot.chosen().filter(mapId::equals).isPresent()) {
      draft.map = Optional.empty();
    }
    if (left.candidates().isEmpty()) {
      if (draft.phase instanceof Phase.Preparing preparing) {
        draft.phase = new Phase.Lobby(Optional.of(preparing.since()), Ballot.NONE);
      } else {
        draft.ballot(Ballot.NONE);
      }
      draft.effect(new MatchEffect.NeedBallot());
      return;
    }
    if (ballot.closed() && ballot.chosen().filter(mapId::equals).isEmpty()) {
      draft.ballot(new Ballot(left.candidates(), left.votes(), ballot.chosen(), ballot.visits()));
    } else if (ballot.closed() || left.candidates().size() == 1) {
      var closed = closed(draft, left);
      draft.ballot(closed);
      announceChoice(draft, closed);
    } else {
      draft.ballot(left);
    }
  }
}
