package com.shepherdjerred.thestorm.essentials.app;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.essentials.domain.tpa.TpaError;
import com.shepherdjerred.thestorm.essentials.domain.tpa.TpaRequest;
import com.shepherdjerred.thestorm.essentials.domain.tpa.TpaRequests;
import com.shepherdjerred.thestorm.essentials.domain.tpa.TpaSelector;
import java.time.InstantSource;
import java.util.List;
import java.util.UUID;

/** The outstanding {@code /tpa} and {@code /tpahere} requests. Main thread only. */
public final class TpaDesk {

  private final InstantSource time;
  private TpaRequests requests;

  public TpaDesk(InstantSource time, TpaRequests.Rules rules) {
    this.time = time;
    this.requests = TpaRequests.empty(rules);
  }

  /** Sends a request; see {@link TpaRequests#send} for when one is refused. */
  public Result<TpaRequest, TpaError> send(
      UUID requester, UUID target, TpaRequest.Direction direction) {
    return requests
        .send(requester, target, direction, time.instant())
        .map(
            sent -> {
              requests = sent.remaining();
              return sent.request();
            });
  }

  /** The request {@code selector} names, left in place. */
  public Result<TpaRequest, TpaError> peek(UUID target, TpaSelector selector) {
    return requests.peek(target, selector, time.instant());
  }

  /** Removes and returns the request {@code selector} names. */
  public Result<TpaRequest, TpaError> take(UUID target, TpaSelector selector) {
    return requests
        .take(target, selector, time.instant())
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

  /** {@code /tptoggle}: flips whether {@code player} receives requests; returns the new setting. */
  public boolean toggle(UUID player) {
    var accepting = !requests.isAccepting(player);
    requests = requests.accepting(player, accepting);
    return accepting;
  }
}
