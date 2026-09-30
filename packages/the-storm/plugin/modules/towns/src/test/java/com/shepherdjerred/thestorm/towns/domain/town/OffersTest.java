package com.shepherdjerred.thestorm.towns.domain.town;

import static com.shepherdjerred.thestorm.towns.domain.Fixtures.MEMBER;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.NOMAD;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.OWNER;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.TOWN_A;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.TOWN_B;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import java.time.Instant;
import org.junit.jupiter.api.Test;

/** Invitations and pending handovers: they expire, and taking one uses it up. */
final class OffersTest {

  private static final Instant NOW = Instant.parse("2026-09-25T12:00:00Z");

  private final Invitations invitations = new Invitations(Duration.ofMinutes(10));
  private final PendingTransfers transfers = new PendingTransfers(Duration.ofSeconds(30));

  @Test
  void anInvitationLastsUntilItExpires() {
    invitations.invite(TOWN_A, NOMAD, NOW);

    assertThat(invitations.isInvited(TOWN_A, NOMAD, NOW.plus(Duration.ofMinutes(9)))).isTrue();
    assertThat(invitations.isInvited(TOWN_A, NOMAD, NOW.plus(Duration.ofMinutes(10)))).isFalse();
    assertThat(invitations.isInvited(TOWN_B, NOMAD, NOW)).isFalse();
    assertThat(invitations.openFor(NOMAD, NOW.plus(Duration.ofMinutes(10)))).isEmpty();
  }

  @Test
  void aNewInvitationRestartsTheClock() {
    invitations.invite(TOWN_A, NOMAD, NOW);
    invitations.invite(TOWN_A, NOMAD, NOW.plus(Duration.ofMinutes(8)));

    assertThat(invitations.isInvited(TOWN_A, NOMAD, NOW.plus(Duration.ofMinutes(15)))).isTrue();
  }

  @Test
  void invitationsFromSeveralTownsAreKeptApart() {
    invitations.invite(TOWN_A, NOMAD, NOW);
    invitations.invite(TOWN_B, NOMAD, NOW);

    assertThat(invitations.openFor(NOMAD, NOW)).containsExactlyInAnyOrder(TOWN_A, TOWN_B);
    assertThat(invitations.withdraw(TOWN_A, NOMAD, NOW)).isTrue();
    assertThat(invitations.withdraw(TOWN_A, NOMAD, NOW)).isFalse();
    assertThat(invitations.openFor(NOMAD, NOW)).containsExactly(TOWN_B);

    invitations.forgetTown(TOWN_B);
    assertThat(invitations.openFor(NOMAD, NOW)).isEmpty();
  }

  @Test
  void joiningForgetsEveryInvitation() {
    invitations.invite(TOWN_A, NOMAD, NOW);
    invitations.invite(TOWN_B, NOMAD, NOW);

    invitations.forgetInvitee(NOMAD);

    assertThat(invitations.openFor(NOMAD, NOW)).isEmpty();
  }

  @Test
  void anExpiredInvitationCannotBeWithdrawnEither() {
    invitations.invite(TOWN_A, NOMAD, NOW);

    assertThat(invitations.withdraw(TOWN_A, NOMAD, NOW.plus(Duration.ofHours(1)))).isFalse();
  }

  @Test
  void aHandoverIsConfirmedOnceWithinItsWindow() {
    var member = new PlayerRef(MEMBER, "Member");
    transfers.request(OWNER, member, NOW);

    assertThat(transfers.pending(OWNER, NOW.plus(Duration.ofSeconds(29)))).contains(member);
    assertThat(transfers.pending(OWNER, NOW.plus(Duration.ofSeconds(29)))).contains(member);
    transfers.done(OWNER);
    assertThat(transfers.pending(OWNER, NOW.plus(Duration.ofSeconds(29)))).isEmpty();

    transfers.request(OWNER, member, NOW);
    assertThat(transfers.pending(OWNER, NOW.plus(Duration.ofSeconds(30)))).isEmpty();
    assertThat(transfers.window()).isEqualTo(Duration.ofSeconds(30));
  }

  @Test
  void offersMustLastAWhile() {
    assertThatThrownBy(() -> new Invitations(Duration.ZERO))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new PendingTransfers(Duration.ofSeconds(-1)))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new MembershipPolicy(0, 60))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new MembershipPolicy(60, 0))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new PlayerRef(NOMAD, " "))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
