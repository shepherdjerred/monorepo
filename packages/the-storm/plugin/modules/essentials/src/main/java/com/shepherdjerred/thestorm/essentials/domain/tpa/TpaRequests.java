package com.shepherdjerred.thestorm.essentials.domain.tpa;

import static java.util.Comparator.comparing;

import com.shepherdjerred.thestorm.core.result.Result;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * The outstanding teleport requests. Immutable: every change returns a new value.
 *
 * <p>A requester has at most one live request per target. Sending again in the same direction
 * replaces it (with a new id); sending in the other direction is refused while the first is live. A
 * requester may send at most one request per {@code interval}, requests lapse {@code timeout} after
 * they are sent, and players who turned requests off receive none.
 */
public final class TpaRequests {

  private final Rules rules;
  private final State state;

  private TpaRequests(Rules rules, State state) {
    this.rules = rules;
    this.state = state;
  }

  /**
   * How requests behave.
   *
   * @param timeout how long a request stays open
   * @param interval the least time between two requests from one player
   */
  public record Rules(Duration timeout, Duration interval) {
    public Rules {
      if (timeout.isNegative() || timeout.isZero()) {
        throw new IllegalArgumentException("timeout must be positive: " + timeout);
      }
      if (interval.isNegative()) {
        throw new IllegalArgumentException("interval must not be negative: " + interval);
      }
    }
  }

  private record State(
      List<TpaRequest> requests, long nextId, Map<UUID, Instant> lastSent, Set<UUID> declining) {
    State {
      requests = List.copyOf(requests);
      lastSent = Map.copyOf(lastSent);
      declining = Set.copyOf(declining);
    }

    State withRequests(List<TpaRequest> next) {
      return new State(next, nextId, lastSent, declining);
    }
  }

  /** No requests. */
  public static TpaRequests empty(Rules rules) {
    return new TpaRequests(rules, new State(List.of(), 1, Map.of(), Set.of()));
  }

  /** The request taken by {@link #take}, and what remains. */
  public record Taken(TpaRequests remaining, TpaRequest request) {}

  /** The requests that lapsed in {@link #expire}, and what remains. */
  public record Expiry(TpaRequests remaining, List<TpaRequest> expired) {
    public Expiry {
      expired = List.copyOf(expired);
    }
  }

  /** Adds a request sent at {@code now}; see the class description for the rules. */
  public Result<Taken, TpaError> send(
      UUID requester, UUID target, TpaRequest.Direction direction, Instant now) {
    var refusal = refusal(requester, target, direction, now);
    if (refusal.isPresent()) {
      return Result.err(refusal.orElseThrow());
    }
    var request = new TpaRequest(state.nextId(), requester, target, direction, now);
    var next = new ArrayList<TpaRequest>();
    for (var existing : state.requests()) {
      if (!samePair(existing, requester, target) && !existing.isExpired(rules.timeout(), now)) {
        next.add(existing);
      }
    }
    next.add(request);
    var lastSent = new HashMap<>(state.lastSent());
    lastSent.put(requester, now);
    var sent =
        new TpaRequests(rules, new State(next, state.nextId() + 1, lastSent, state.declining()));
    return Result.ok(new Taken(sent, request));
  }

  /** The live request {@code selector} names for {@code target}, without removing it. */
  public Result<TpaRequest, TpaError> peek(UUID target, TpaSelector selector, Instant now) {
    var live = pendingFor(target, now);
    return switch (selector) {
      case TpaSelector.Newest() ->
          live.stream()
              .findFirst()
              .<Result<TpaRequest, TpaError>>map(Result::ok)
              .orElseGet(() -> Result.err(new TpaError.NoPendingRequest()));
      case TpaSelector.From(var requester) ->
          from(live, requester)
              .<Result<TpaRequest, TpaError>>map(Result::ok)
              .orElseGet(() -> Result.err(new TpaError.NoRequestFrom(requester)));
      case TpaSelector.Exact(var requester, var id) ->
          from(live, requester)
              .filter(request -> request.id() == id)
              .<Result<TpaRequest, TpaError>>map(Result::ok)
              .orElseGet(() -> Result.err(new TpaError.NoSuchRequest(id)));
    };
  }

  /** Removes and returns the request {@code selector} names. Used for accepting and denying. */
  public Result<Taken, TpaError> take(UUID target, TpaSelector selector, Instant now) {
    return peek(target, selector, now)
        .map(
            request ->
                new Taken(
                    new TpaRequests(
                        rules,
                        state.withRequests(
                            state.requests().stream().filter(r -> !r.equals(request)).toList())),
                    request));
  }

  /** {@code target}'s live requests, most recent first. */
  public List<TpaRequest> pendingFor(UUID target, Instant now) {
    return state.requests().stream()
        .filter(r -> r.target().equals(target) && !r.isExpired(rules.timeout(), now))
        .sorted(comparing(TpaRequest::sentAt).thenComparingLong(TpaRequest::id).reversed())
        .toList();
  }

  /** Drops every request that has lapsed by {@code now}. */
  public Expiry expire(Instant now) {
    var expired = state.requests().stream().filter(r -> r.isExpired(rules.timeout(), now)).toList();
    if (expired.isEmpty()) {
      return new Expiry(this, List.of());
    }
    var live = state.requests().stream().filter(r -> !r.isExpired(rules.timeout(), now)).toList();
    return new Expiry(new TpaRequests(rules, state.withRequests(live)), expired);
  }

  /** Drops every request to or from {@code player}, for example when they leave. */
  public TpaRequests forget(UUID player) {
    var kept =
        state.requests().stream()
            .filter(r -> !r.requester().equals(player) && !r.target().equals(player))
            .toList();
    return new TpaRequests(rules, state.withRequests(kept));
  }

  /** {@code /tptoggle}: whether {@code player} receives requests. Turning them off drops theirs. */
  public TpaRequests accepting(UUID player, boolean accepting) {
    var declining = new HashSet<>(state.declining());
    var requests = state.requests();
    if (accepting) {
      declining.remove(player);
    } else {
      declining.add(player);
      requests = requests.stream().filter(r -> !r.target().equals(player)).toList();
    }
    return new TpaRequests(rules, new State(requests, state.nextId(), state.lastSent(), declining));
  }

  /** Whether {@code player} receives requests. */
  public boolean isAccepting(UUID player) {
    return !state.declining().contains(player);
  }

  /** Every stored request, including any that have lapsed but not been expired yet. */
  public List<TpaRequest> all() {
    return state.requests();
  }

  private Optional<TpaError> refusal(
      UUID requester, UUID target, TpaRequest.Direction direction, Instant now) {
    if (requester.equals(target)) {
      return Optional.of(new TpaError.SelfRequest());
    }
    if (!isAccepting(target)) {
      return Optional.of(new TpaError.NotAccepting());
    }
    var last = state.lastSent().get(requester);
    if (last != null && now.isBefore(last.plus(rules.interval()))) {
      return Optional.of(new TpaError.TooSoon(Duration.between(now, last.plus(rules.interval()))));
    }
    return state.requests().stream()
        .filter(r -> samePair(r, requester, target) && !r.isExpired(rules.timeout(), now))
        .filter(r -> r.direction() != direction)
        .findFirst()
        .map(r -> new TpaError.Conflicting(r.direction()));
  }

  private static boolean samePair(TpaRequest request, UUID requester, UUID target) {
    return request.requester().equals(requester) && request.target().equals(target);
  }

  private static Optional<TpaRequest> from(List<TpaRequest> live, UUID requester) {
    return live.stream().filter(r -> r.requester().equals(requester)).findFirst();
  }
}
