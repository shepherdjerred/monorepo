package com.shepherdjerred.thestorm.essentials.domain.tpa;

import static java.util.Comparator.comparing;

import com.shepherdjerred.thestorm.core.result.Result;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * The outstanding teleport requests. Immutable: every change returns a new value.
 *
 * <p>A requester has at most one request per target; sending again replaces it. Requests lapse
 * {@code timeout} after they are sent.
 */
public final class TpaRequests {

  private final Duration timeout;
  private final List<TpaRequest> requests;

  private TpaRequests(Duration timeout, List<TpaRequest> requests) {
    this.timeout = timeout;
    this.requests = List.copyOf(requests);
  }

  /** No requests, lapsing after {@code timeout}. */
  public static TpaRequests empty(Duration timeout) {
    if (timeout.isNegative() || timeout.isZero()) {
      throw new IllegalArgumentException("timeout must be positive: " + timeout);
    }
    return new TpaRequests(timeout, List.of());
  }

  /** The request taken by {@link #take}, and what remains. */
  public record Taken(TpaRequests remaining, TpaRequest request) {}

  /** The requests that lapsed in {@link #expire}, and what remains. */
  public record Expiry(TpaRequests remaining, List<TpaRequest> expired) {
    public Expiry {
      expired = List.copyOf(expired);
    }
  }

  /** Adds a request sent at {@code now}, replacing any earlier one between the same players. */
  public Result<TpaRequests, TpaError> send(
      UUID requester, UUID target, TpaRequest.Direction direction, Instant now) {
    if (requester.equals(target)) {
      return Result.err(new TpaError.SelfRequest());
    }
    var next = new ArrayList<TpaRequest>();
    for (var request : requests) {
      var samePair = request.requester().equals(requester) && request.target().equals(target);
      if (!samePair && !request.isExpired(timeout, now)) {
        next.add(request);
      }
    }
    next.add(new TpaRequest(requester, target, direction, now));
    return Result.ok(new TpaRequests(timeout, next));
  }

  /**
   * Removes and returns {@code target}'s live request from {@code requester}, or their most recent
   * live request when no requester is named. Used for both accepting and denying.
   */
  public Result<Taken, TpaError> take(UUID target, Optional<UUID> requester, Instant now) {
    var live = pendingFor(target, now);
    var chosen =
        requester.isPresent()
            ? live.stream()
                .filter(request -> request.requester().equals(requester.orElseThrow()))
                .findFirst()
            : live.stream().findFirst();
    if (chosen.isEmpty()) {
      return Result.err(
          requester
              .<TpaError>map(TpaError.NoRequestFrom::new)
              .orElseGet(TpaError.NoPendingRequest::new));
    }
    var request = chosen.orElseThrow();
    var rest = requests.stream().filter(other -> !other.equals(request)).toList();
    return Result.ok(new Taken(new TpaRequests(timeout, rest), request));
  }

  /** {@code target}'s live requests, most recent first. */
  public List<TpaRequest> pendingFor(UUID target, Instant now) {
    return requests.stream()
        .filter(request -> request.target().equals(target) && !request.isExpired(timeout, now))
        .sorted(comparing(TpaRequest::sentAt).reversed())
        .toList();
  }

  /** Drops every request that has lapsed by {@code now}. */
  public Expiry expire(Instant now) {
    var expired = requests.stream().filter(request -> request.isExpired(timeout, now)).toList();
    if (expired.isEmpty()) {
      return new Expiry(this, List.of());
    }
    var live = requests.stream().filter(request -> !request.isExpired(timeout, now)).toList();
    return new Expiry(new TpaRequests(timeout, live), expired);
  }

  /** Drops every request to or from {@code player}, for example when they leave. */
  public TpaRequests forget(UUID player) {
    return new TpaRequests(
        timeout,
        requests.stream()
            .filter(r -> !r.requester().equals(player) && !r.target().equals(player))
            .toList());
  }

  /** Every stored request, including any that have lapsed but not been expired yet. */
  public List<TpaRequest> all() {
    return requests;
  }
}
