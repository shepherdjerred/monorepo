package com.shepherdjerred.thestorm.essentials.app;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.essentials.domain.tpa.TpaError;
import com.shepherdjerred.thestorm.essentials.domain.tpa.TpaRequest;
import com.shepherdjerred.thestorm.essentials.domain.tpa.TpaRequests;
import java.time.Duration;
import java.time.InstantSource;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** The outstanding {@code /tpa} and {@code /tpahere} requests. Main thread only. */
public final class TpaDesk {

  private final InstantSource time;
  private TpaRequests requests;

  public TpaDesk(InstantSource time, Duration timeout) {
    this.time = time;
    this.requests = TpaRequests.empty(timeout);
  }

  /** Sends a request, replacing any earlier one from the same requester to the same target. */
  public Result<TpaRequest, TpaError> send(
      UUID requester, UUID target, TpaRequest.Direction direction) {
    var now = time.instant();
    return requests
        .send(requester, target, direction, now)
        .map(
            next -> {
              requests = next;
              return next.pendingFor(target, now).getFirst();
            });
  }

  /** Removes {@code target}'s request from {@code requester}, or their newest one. */
  public Result<TpaRequest, TpaError> take(UUID target, Optional<UUID> requester) {
    return requests
        .take(target, requester, time.instant())
        .map(
            taken -> {
              requests = taken.remaining();
              return taken.request();
            });
  }

  /** Drops lapsed requests and returns them, so both players can be told. */
  public List<TpaRequest> expire() {
    var expiry = requests.expire(time.instant());
    requests = expiry.remaining();
    return expiry.expired();
  }

  /** Drops every request to or from {@code player}. */
  public void forget(UUID player) {
    requests = requests.forget(player);
  }
}
