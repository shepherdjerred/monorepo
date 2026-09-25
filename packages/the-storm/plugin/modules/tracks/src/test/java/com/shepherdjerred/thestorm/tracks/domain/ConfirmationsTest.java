package com.shepherdjerred.thestorm.tracks.domain;

import static com.shepherdjerred.thestorm.tracks.domain.Progressions.NOW;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import org.junit.jupiter.api.Test;

final class ConfirmationsTest {

  private static final Duration WINDOW = Duration.ofSeconds(30);

  private final Confirmations<String, String> confirmations = new Confirmations<>(WINDOW);

  @Test
  void nothingOfferedConfirmsNothing() {
    assertThat(confirmations.confirm("alice", value -> true, NOW)).isEmpty();
  }

  @Test
  void aMatchingConfirmationWithinTheWindowSucceedsOnce() {
    confirmations.offer("alice", "mechanic", NOW);

    assertThat(confirmations.confirm("alice", "mechanic"::equals, NOW.plusSeconds(10)))
        .contains("mechanic");
    assertThat(confirmations.confirm("alice", "mechanic"::equals, NOW.plusSeconds(11))).isEmpty();
  }

  @Test
  void theLastInstantOfTheWindowStillConfirms() {
    confirmations.offer("alice", "mechanic", NOW);

    assertThat(confirmations.confirm("alice", value -> true, NOW.plus(WINDOW)))
        .contains("mechanic");
  }

  @Test
  void anExpiredOfferIsDiscarded() {
    confirmations.offer("alice", "mechanic", NOW);

    assertThat(confirmations.confirm("alice", value -> true, NOW.plus(WINDOW).plusNanos(1)))
        .isEmpty();
    assertThat(confirmations.confirm("alice", value -> true, NOW)).isEmpty();
  }

  @Test
  void aDifferentRequestDoesNotConfirmButKeepsTheOffer() {
    confirmations.offer("alice", "mechanic", NOW);

    assertThat(confirmations.confirm("alice", "engineer"::equals, NOW)).isEmpty();
    assertThat(confirmations.confirm("alice", "mechanic"::equals, NOW)).contains("mechanic");
  }

  @Test
  void aNewOfferReplacesTheOldOneAndRestartsTheWindow() {
    confirmations.offer("alice", "mechanic", NOW);
    confirmations.offer("alice", "engineer", NOW.plusSeconds(20));

    assertThat(confirmations.confirm("alice", "mechanic"::equals, NOW.plusSeconds(40))).isEmpty();
    assertThat(confirmations.confirm("alice", "engineer"::equals, NOW.plusSeconds(40)))
        .contains("engineer");
  }

  @Test
  void offersArePerKey() {
    confirmations.offer("alice", "mechanic", NOW);

    assertThat(confirmations.confirm("bob", value -> true, NOW)).isEmpty();
    assertThat(confirmations.confirm("alice", value -> true, NOW)).contains("mechanic");
  }

  @Test
  void forgettingDropsTheOffer() {
    confirmations.offer("alice", "mechanic", NOW);
    confirmations.forget("alice");

    assertThat(confirmations.confirm("alice", value -> true, NOW)).isEmpty();
  }

  @Test
  void theWindowMustBePositive() {
    assertThatThrownBy(() -> new Confirmations<String, String>(Duration.ZERO))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
