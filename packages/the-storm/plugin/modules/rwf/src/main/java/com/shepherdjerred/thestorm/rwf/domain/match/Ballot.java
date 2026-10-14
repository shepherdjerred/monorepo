package com.shepherdjerred.thestorm.rwf.domain.match;

import static java.util.Collections.unmodifiableMap;

import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.random.RandomGenerator;

/**
 * The lobby's map vote: up to {@link #SIZE} candidate maps, one vote per member, and once the vote
 * closes the map it chose. Immutable.
 *
 * @param candidates the maps on offer, in the order they are shown
 * @param votes each member's choice, by map id
 * @param chosen the map the vote settled on, once it closed
 */
public record Ballot(
    List<Candidate> candidates,
    Map<CombatantId, String> votes,
    Optional<String> chosen,
    Optional<Visits> visits) {

  /** Candidate terrain must be ready before the guaranteed voting opportunity begins. */
  public record Visits(Duration length, Optional<Instant> readyAt) {
    public Visits {
      if (length.isNegative() || length.isZero()) {
        throw new IllegalArgumentException("candidate voting time must be positive");
      }
    }

    public Optional<Instant> until(Instant waitingSince) {
      return readyAt.map(
          ready -> (ready.isAfter(waitingSince) ? ready : waitingSince).plus(length));
    }
  }

  /** Ballots without candidate visits retain the original countdown behavior. */
  public Ballot(
      List<Candidate> candidates, Map<CombatantId, String> votes, Optional<String> chosen) {
    this(candidates, votes, chosen, Optional.empty());
  }

  /** How many maps a ballot offers. */
  public static final int SIZE = 3;

  /** A ballot that has not been opened yet. */
  public static final Ballot NONE = new Ballot(List.of(), Map.of(), Optional.empty());

  public Ballot {
    candidates = List.copyOf(candidates);
    if (candidates.size() > SIZE) {
      throw new IllegalArgumentException("a ballot offers at most " + SIZE + " maps");
    }
    var ids = new HashSet<String>();
    for (var candidate : candidates) {
      if (!ids.add(candidate.mapId())) {
        throw new IllegalArgumentException("a ballot offers each map once: " + candidate.mapId());
      }
    }
    for (var vote : votes.values()) {
      if (!ids.contains(vote)) {
        throw new IllegalArgumentException("a vote names a map on the ballot: " + vote);
      }
    }
    if (chosen.isPresent() && !ids.contains(chosen.orElseThrow())) {
      throw new IllegalArgumentException("the ballot chose a map it does not offer");
    }
    votes = unmodifiableMap(new LinkedHashMap<>(votes));
  }

  /**
   * A map on the ballot.
   *
   * @param mapId the map
   * @param name its display name
   * @param author who built it
   */
  public record Candidate(String mapId, String name, String author) {

    public Candidate {
      if (mapId.isBlank() || name.isBlank() || author.isBlank()) {
        throw new IllegalArgumentException("a candidate names its map, title and author");
      }
    }
  }

  /** A fresh ballot over {@code candidates}. */
  public static Ballot open(List<Candidate> candidates) {
    return open(candidates, Optional.empty());
  }

  static Ballot open(List<Candidate> candidates, Optional<Duration> visitLength) {
    if (candidates.isEmpty()) {
      throw new IllegalArgumentException("a ballot needs at least one map");
    }
    return new Ballot(
        candidates,
        Map.of(),
        Optional.empty(),
        visitLength.map(length -> new Visits(length, Optional.empty())));
  }

  Ballot visitsReady(Instant now) {
    return new Ballot(
        candidates,
        votes,
        chosen,
        visits.map(window -> new Visits(window.length(), Optional.of(now))));
  }

  /** A loading ballot or an unexpired visit opportunity cannot advance automatically. */
  boolean awaitingVisits(Instant waitingSince, Instant now) {
    return !closed()
        && visits
            .map(
                window -> window.until(waitingSince).map(until -> now.isBefore(until)).orElse(true))
            .orElse(false);
  }

  /** Whether the ballot has maps to vote on. */
  public boolean opened() {
    return !candidates.isEmpty();
  }

  public boolean closed() {
    return chosen.isPresent();
  }

  public Optional<Candidate> candidate(String mapId) {
    return candidates.stream().filter(c -> c.mapId().equals(mapId)).findFirst();
  }

  /** {@code voter} votes for {@code mapId}, replacing an earlier vote. */
  Ballot vote(CombatantId voter, String mapId) {
    var next = new LinkedHashMap<>(votes);
    next.put(voter, mapId);
    return new Ballot(candidates, next, chosen, visits);
  }

  /** {@code voter} left: their vote no longer counts. */
  Ballot withdraw(CombatantId voter) {
    if (!votes.containsKey(voter)) {
      return this;
    }
    var next = new LinkedHashMap<>(votes);
    next.remove(voter);
    return new Ballot(candidates, next, chosen, visits);
  }

  /** How many votes {@code mapId} has. */
  public int count(String mapId) {
    return (int) votes.values().stream().filter(mapId::equals).count();
  }

  /**
   * The vote closes: the map with the most votes wins, ties (and an empty vote) broken by {@code
   * random}.
   */
  Ballot close(RandomGenerator random) {
    var best = new ArrayList<String>();
    var most = -1;
    for (var candidate : candidates) {
      var count = count(candidate.mapId());
      if (count > most) {
        most = count;
        best.clear();
      }
      if (count == most) {
        best.add(candidate.mapId());
      }
    }
    return new Ballot(
        candidates, votes, Optional.of(best.get(random.nextInt(best.size()))), visits);
  }

  /** An operator settles the map: it is the only candidate left, and chosen. */
  static Ballot forced(Candidate candidate) {
    return new Ballot(List.of(candidate), Map.of(), Optional.of(candidate.mapId()));
  }

  /** {@code mapId} could not be loaded: it leaves the ballot, and the vote is open again. */
  Ballot without(String mapId) {
    var left = candidates.stream().filter(c -> !c.mapId().equals(mapId)).toList();
    var kept = new LinkedHashMap<CombatantId, String>();
    votes.forEach(
        (voter, vote) -> {
          if (!vote.equals(mapId)) {
            kept.put(voter, vote);
          }
        });
    return new Ballot(left, kept, Optional.empty(), visits);
  }
}
