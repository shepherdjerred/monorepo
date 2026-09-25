package com.shepherdjerred.thestorm.essentials.domain.tpa;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.groups.Tuple.tuple;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.essentials.domain.tpa.TpaRequest.Direction;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;

final class TpaRequestsTest {

  static final Instant T0 = Instant.parse("2026-09-25T12:00:00Z");
  static final Duration TIMEOUT = Duration.ofSeconds(60);
  static final Duration INTERVAL = Duration.ofSeconds(10);
  static final UUID ALICE = UUID.fromString("00000000-0000-0000-0000-00000000000a");
  static final UUID BOB = UUID.fromString("00000000-0000-0000-0000-00000000000b");
  static final UUID CAROL = UUID.fromString("00000000-0000-0000-0000-00000000000c");

  final TpaRequests empty = TpaRequests.empty(new TpaRequests.Rules(TIMEOUT, INTERVAL));

  /** A {@code /tpa} from {@code from} to {@code to}, which must be accepted. */
  static TpaRequests.Taken taken(TpaRequests requests, UUID from, UUID to, Instant at) {
    return requests
        .send(from, to, Direction.TO_TARGET, at)
        .fold(
            taken -> taken,
            error -> {
              throw new AssertionError(error);
            });
  }

  static TpaRequests sent(TpaRequests requests, UUID from, UUID to, Instant at) {
    return taken(requests, from, to, at).remaining();
  }

  @Test
  void rulesValidateTheirDurations() {
    assertThatThrownBy(() -> new TpaRequests.Rules(Duration.ZERO, INTERVAL))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new TpaRequests.Rules(TIMEOUT, Duration.ofSeconds(-1)))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void aPlayerCannotAskThemself() {
    assertThat(empty.send(ALICE, ALICE, Direction.TO_TARGET, T0))
        .isEqualTo(Result.err(new TpaError.SelfRequest()));
    assertThatThrownBy(() -> new TpaRequest(1, ALICE, ALICE, Direction.TO_TARGET, T0))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void tpaMovesTheRequesterAndTpahereMovesTheTarget() {
    var tpa = new TpaRequest(1, ALICE, BOB, Direction.TO_TARGET, T0);
    var tpahere = new TpaRequest(2, ALICE, BOB, Direction.TO_REQUESTER, T0);

    assertThat(tpa.mover()).isEqualTo(ALICE);
    assertThat(tpa.destination()).isEqualTo(BOB);
    assertThat(tpahere.mover()).isEqualTo(BOB);
    assertThat(tpahere.destination()).isEqualTo(ALICE);
  }

  @Test
  void requestsAreLiveUntilJustBeforeTheTimeout() {
    var request = new TpaRequest(1, ALICE, BOB, Direction.TO_TARGET, T0);

    assertThat(request.isExpired(TIMEOUT, T0.plus(TIMEOUT).minusMillis(1))).isFalse();
    assertThat(request.isExpired(TIMEOUT, T0.plus(TIMEOUT))).isTrue();
  }

  @Test
  void everyRequestGetsANewId() {
    var first = taken(empty, ALICE, BOB, T0);
    var second = taken(first.remaining(), CAROL, BOB, T0);

    assertThat(second.request().id()).isGreaterThan(first.request().id());
  }

  @Test
  void resendingTheSameDirectionReplacesTheRequestWithANewId() {
    var first = taken(empty, ALICE, BOB, T0);
    var again = taken(first.remaining(), ALICE, BOB, T0.plus(INTERVAL));

    assertThat(again.remaining().all()).containsExactly(again.request());
    assertThat(again.request().id()).isNotEqualTo(first.request().id());
  }

  @Test
  void theOtherDirectionIsRefusedWhileARequestIsLive() {
    var requests = sent(empty, ALICE, BOB, T0);

    assertThat(requests.send(ALICE, BOB, Direction.TO_REQUESTER, T0.plus(INTERVAL)))
        .isEqualTo(Result.err(new TpaError.Conflicting(Direction.TO_TARGET)));
  }

  @Test
  void theOtherDirectionIsAllowedOnceTheRequestLapses() {
    var requests = sent(empty, ALICE, BOB, T0);

    assertThat(requests.send(ALICE, BOB, Direction.TO_REQUESTER, T0.plus(TIMEOUT)).isOk()).isTrue();
  }

  @Test
  void requestsAreRateLimitedPerRequester() {
    var requests = sent(empty, ALICE, BOB, T0);

    assertThat(requests.send(ALICE, CAROL, Direction.TO_TARGET, T0.plusSeconds(4)))
        .isEqualTo(Result.err(new TpaError.TooSoon(Duration.ofSeconds(6))));
    assertThat(requests.send(ALICE, CAROL, Direction.TO_TARGET, T0.plus(INTERVAL)).isOk()).isTrue();
    assertThat(requests.send(CAROL, BOB, Direction.TO_TARGET, T0.plusSeconds(1)).isOk()).isTrue();
  }

  @Test
  void aZeroIntervalAllowsBackToBackRequests() {
    var open = TpaRequests.empty(new TpaRequests.Rules(TIMEOUT, Duration.ZERO));
    var requests = sent(open, ALICE, BOB, T0);

    assertThat(requests.send(ALICE, CAROL, Direction.TO_TARGET, T0).isOk()).isTrue();
  }

  @Test
  void playersCanTurnRequestsOff() {
    var pending = sent(empty, ALICE, BOB, T0);
    var off = pending.accepting(BOB, false);

    assertThat(off.isAccepting(BOB)).isFalse();
    assertThat(off.all()).isEmpty();
    assertThat(off.send(CAROL, BOB, Direction.TO_TARGET, T0))
        .isEqualTo(Result.err(new TpaError.NotAccepting()));
    assertThat(off.accepting(BOB, true).send(CAROL, BOB, Direction.TO_TARGET, T0).isOk()).isTrue();
  }

  @Test
  void newestTakesTheMostRecent() {
    var requests = sent(sent(empty, ALICE, BOB, T0), CAROL, BOB, T0.plusSeconds(1));

    var taken = requests.take(BOB, new TpaSelector.Newest(), T0.plusSeconds(2));

    assertThat(taken.map(TpaRequests.Taken::request).map(TpaRequest::requester))
        .isEqualTo(Result.ok(CAROL));
    assertThat(taken.map(t -> t.remaining().pendingFor(BOB, T0.plusSeconds(2)).size()))
        .isEqualTo(Result.ok(1));
  }

  @Test
  void fromTakesThatRequestersRequest() {
    var requests = sent(sent(empty, ALICE, BOB, T0), CAROL, BOB, T0.plusSeconds(1));

    assertThat(
            requests
                .take(BOB, new TpaSelector.From(ALICE), T0.plusSeconds(2))
                .map(TpaRequests.Taken::request)
                .map(TpaRequest::requester))
        .isEqualTo(Result.ok(ALICE));
  }

  @Test
  void exactMatchesOnlyTheRequestTheTargetWasShown() {
    var shown = taken(empty, ALICE, BOB, T0);
    var id = shown.request().id();

    assertThat(shown.remaining().peek(BOB, new TpaSelector.Exact(ALICE, id), T0))
        .isEqualTo(Result.ok(shown.request()));
    assertThat(shown.remaining().peek(BOB, new TpaSelector.Exact(ALICE, id + 1), T0))
        .isEqualTo(Result.err(new TpaError.NoSuchRequest(id + 1)));
    assertThat(shown.remaining().peek(BOB, new TpaSelector.Exact(CAROL, id), T0))
        .isEqualTo(Result.err(new TpaError.NoSuchRequest(id)));
  }

  @Test
  void aReplacedRequestCannotBeAcceptedByItsOldId() {
    var shown = taken(empty, ALICE, BOB, T0);
    var replaced = taken(shown.remaining(), ALICE, BOB, T0.plus(INTERVAL));

    assertThat(
            replaced
                .remaining()
                .take(BOB, new TpaSelector.Exact(ALICE, shown.request().id()), T0.plus(INTERVAL)))
        .isEqualTo(Result.err(new TpaError.NoSuchRequest(shown.request().id())));
  }

  @Test
  void peekLeavesTheRequestInPlace() {
    var requests = sent(empty, ALICE, BOB, T0);

    assertThat(requests.peek(BOB, new TpaSelector.Newest(), T0).isOk()).isTrue();
    assertThat(requests.pendingFor(BOB, T0)).hasSize(1);
  }

  @Test
  void takeFailsWithNothingPending() {
    assertThat(empty.take(BOB, new TpaSelector.Newest(), T0))
        .isEqualTo(Result.err(new TpaError.NoPendingRequest()));
    assertThat(sent(empty, CAROL, BOB, T0).take(BOB, new TpaSelector.From(ALICE), T0))
        .isEqualTo(Result.err(new TpaError.NoRequestFrom(ALICE)));
  }

  @Test
  void anExpiredRequestCannotBeAccepted() {
    var requests = sent(empty, ALICE, BOB, T0);

    assertThat(requests.take(BOB, new TpaSelector.From(ALICE), T0.plus(TIMEOUT)))
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
        .extracting(TpaRequest::requester, TpaRequest::target)
        .containsExactly(tuple(CAROL, ALICE));
  }
}
