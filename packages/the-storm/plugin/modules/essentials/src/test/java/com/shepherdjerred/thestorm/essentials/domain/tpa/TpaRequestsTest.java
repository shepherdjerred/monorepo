package com.shepherdjerred.thestorm.essentials.domain.tpa;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.essentials.domain.tpa.TpaRequest.Direction;
import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;

final class TpaRequestsTest {

  static final Instant T0 = Instant.parse("2026-09-25T12:00:00Z");
  static final Duration TIMEOUT = Duration.ofSeconds(60);
  static final UUID ALICE = UUID.fromString("00000000-0000-0000-0000-00000000000a");
  static final UUID BOB = UUID.fromString("00000000-0000-0000-0000-00000000000b");
  static final UUID CAROL = UUID.fromString("00000000-0000-0000-0000-00000000000c");

  static TpaRequests sent(TpaRequests requests, UUID from, UUID to, Instant at) {
    return requests
        .send(from, to, Direction.TO_TARGET, at)
        .fold(
            r -> r,
            e -> {
              throw new AssertionError(e);
            });
  }

  final TpaRequests empty = TpaRequests.empty(TIMEOUT);

  @Test
  void timeoutMustBePositive() {
    assertThatThrownBy(() -> TpaRequests.empty(Duration.ZERO))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void aPlayerCannotAskThemself() {
    assertThat(empty.send(ALICE, ALICE, Direction.TO_TARGET, T0))
        .isEqualTo(Result.err(new TpaError.SelfRequest()));
    assertThatThrownBy(() -> new TpaRequest(ALICE, ALICE, Direction.TO_TARGET, T0))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void tpaMovesTheRequesterAndTpahereMovesTheTarget() {
    var tpa = new TpaRequest(ALICE, BOB, Direction.TO_TARGET, T0);
    var tpahere = new TpaRequest(ALICE, BOB, Direction.TO_REQUESTER, T0);

    assertThat(tpa.mover()).isEqualTo(ALICE);
    assertThat(tpa.destination()).isEqualTo(BOB);
    assertThat(tpahere.mover()).isEqualTo(BOB);
    assertThat(tpahere.destination()).isEqualTo(ALICE);
  }

  @Test
  void requestsAreLiveUntilJustBeforeTheTimeout() {
    var request = new TpaRequest(ALICE, BOB, Direction.TO_TARGET, T0);

    assertThat(request.isExpired(TIMEOUT, T0.plus(TIMEOUT).minusMillis(1))).isFalse();
    assertThat(request.isExpired(TIMEOUT, T0.plus(TIMEOUT))).isTrue();
  }

  @Test
  void resendingReplacesTheEarlierRequest() {
    var requests = sent(sent(empty, ALICE, BOB, T0), ALICE, BOB, T0.plusSeconds(30));

    assertThat(requests.all())
        .containsExactly(new TpaRequest(ALICE, BOB, Direction.TO_TARGET, T0.plusSeconds(30)));
  }

  @Test
  void takeWithoutANameTakesTheNewest() {
    var requests = sent(sent(empty, ALICE, BOB, T0), CAROL, BOB, T0.plusSeconds(1));

    var taken = requests.take(BOB, Optional.empty(), T0.plusSeconds(2));

    assertThat(taken.map(TpaRequests.Taken::request).map(TpaRequest::requester))
        .isEqualTo(Result.ok(CAROL));
    assertThat(taken.map(t -> t.remaining().pendingFor(BOB, T0.plusSeconds(2)).size()))
        .isEqualTo(Result.ok(1));
  }

  @Test
  void takeFromANamedRequester() {
    var requests = sent(sent(empty, ALICE, BOB, T0), CAROL, BOB, T0.plusSeconds(1));

    var taken = requests.take(BOB, Optional.of(ALICE), T0.plusSeconds(2));

    assertThat(taken.map(TpaRequests.Taken::request).map(TpaRequest::requester))
        .isEqualTo(Result.ok(ALICE));
  }

  @Test
  void takeFailsWithNothingPending() {
    assertThat(empty.take(BOB, Optional.empty(), T0))
        .isEqualTo(Result.err(new TpaError.NoPendingRequest()));
    assertThat(sent(empty, CAROL, BOB, T0).take(BOB, Optional.of(ALICE), T0))
        .isEqualTo(Result.err(new TpaError.NoRequestFrom(ALICE)));
  }

  @Test
  void anExpiredRequestCannotBeAccepted() {
    var requests = sent(empty, ALICE, BOB, T0);

    assertThat(requests.take(BOB, Optional.of(ALICE), T0.plus(TIMEOUT)))
        .isEqualTo(Result.err(new TpaError.NoRequestFrom(ALICE)));
  }

  @Test
  void requestsOnlyShowForTheirTarget() {
    var requests = sent(empty, ALICE, BOB, T0);

    assertThat(requests.pendingFor(ALICE, T0)).isEmpty();
    assertThat(requests.pendingFor(BOB, T0)).hasSize(1);
  }

  @Test
  void expireRemovesAndReportsLapsedRequests() {
    var requests = sent(sent(empty, ALICE, BOB, T0), CAROL, BOB, T0.plusSeconds(30));

    var expiry = requests.expire(T0.plus(TIMEOUT));

    assertThat(expiry.expired()).extracting(TpaRequest::requester).containsExactly(ALICE);
    assertThat(expiry.remaining().all()).extracting(TpaRequest::requester).containsExactly(CAROL);
  }

  @Test
  void expiringNothingKeepsTheSameRequests() {
    var requests = sent(empty, ALICE, BOB, T0);

    var expiry = requests.expire(T0);

    assertThat(expiry.expired()).isEmpty();
    assertThat(expiry.remaining()).isSameAs(requests);
  }

  @Test
  void sendingDropsLapsedRequestsOnTheWay() {
    var requests = sent(sent(empty, ALICE, BOB, T0), CAROL, BOB, T0.plus(TIMEOUT));

    assertThat(requests.all()).extracting(TpaRequest::requester).containsExactly(CAROL);
  }

  @Test
  void forgettingAPlayerDropsTheirRequestsBothWays() {
    var requests = sent(sent(sent(empty, ALICE, BOB, T0), BOB, CAROL, T0), CAROL, ALICE, T0);

    assertThat(requests.forget(BOB).all())
        .containsExactly(new TpaRequest(CAROL, ALICE, Direction.TO_TARGET, T0));
  }
}
