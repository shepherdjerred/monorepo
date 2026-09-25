package com.shepherdjerred.thestorm.essentials.domain.moderation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;

final class ModerationTest {

  static final Instant T0 = Instant.parse("2026-09-25T12:00:00Z");
  static final UUID GRIEFER = UUID.fromString("00000000-0000-0000-0000-0000000000ff");
  static final Actor STAFF =
      Actor.player(UUID.fromString("00000000-0000-0000-0000-000000000001"), "RiotShielder");

  static AuditEntry entry(ModerationAction action, Optional<Duration> length, Instant at) {
    return AuditEntry.of(GRIEFER, action, STAFF, new AuditEntry.Term(length, "griefing", at));
  }

  static AuditEntry ban(Instant at) {
    return entry(ModerationAction.BAN, Optional.empty(), at);
  }

  static AuditEntry tempban(Duration length, Instant at) {
    return entry(ModerationAction.BAN, Optional.of(length), at);
  }

  static Standing replay(AuditEntry... entries) {
    var standing = Standing.CLEAN;
    for (var entry : entries) {
      standing = standing.apply(entry);
    }
    return standing;
  }

  @EnumSource(ModerationAction.class)
  @ParameterizedTest
  void actionIdsRoundTrip(ModerationAction action) {
    assertThat(ModerationAction.fromId(action.id())).isEqualTo(action);
  }

  @Test
  void unknownActionIdIsAnError() {
    assertThatThrownBy(() -> ModerationAction.fromId("mute"))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void onlyBansExpire() {
    assertThat(ModerationAction.BAN.canExpire()).isTrue();
    assertThat(ModerationAction.KICK.canExpire()).isFalse();
    assertThat(ModerationAction.UNBAN.canExpire()).isFalse();
  }

  @Test
  void aCleanPlayerIsNotBanned() {
    assertThat(Standing.CLEAN.activeBan(T0)).isEmpty();
  }

  @Test
  void aPermanentBanNeverEnds() {
    assertThat(replay(ban(T0)).activeBan(T0.plus(Duration.ofDays(36_500)))).isPresent();
  }

  @Test
  void aTempbanEndsExactlyAtItsExpiry() {
    var standing = replay(tempban(Duration.ofDays(3), T0));
    var end = T0.plus(Duration.ofDays(3));

    assertThat(standing.activeBan(end.minusMillis(1))).isPresent();
    assertThat(standing.activeBan(end)).isEmpty();
    assertThat(standing.ban()).isPresent();
  }

  @Test
  void anUnbanLiftsTheBan() {
    assertThat(replay(ban(T0), entry(ModerationAction.UNBAN, Optional.empty(), T0.plusSeconds(1))))
        .isEqualTo(Standing.CLEAN);
  }

  @Test
  void aLaterBanReplacesAnEarlierOne() {
    var standing = replay(ban(T0), tempban(Duration.ofHours(1), T0.plusSeconds(10)));

    assertThat(standing.ban().orElseThrow().expiresAt())
        .contains(T0.plusSeconds(10).plus(Duration.ofHours(1)));
  }

  @Test
  void kicksLeaveTheStandingAlone() {
    var banned = replay(ban(T0));
    assertThat(banned.apply(entry(ModerationAction.KICK, Optional.empty(), T0))).isEqualTo(banned);
  }

  @Test
  void theBanRemembersWhoAndWhy() {
    var ban = replay(ban(T0)).activeBan(T0).orElseThrow();

    assertThat(ban.reason()).isEqualTo("griefing");
    assertThat(ban.actor()).isEqualTo(STAFF);
    assertThat(ban.at()).isEqualTo(T0);
  }

  @Test
  void remainingTimeCountsDownToZero() {
    var ban = replay(tempban(Duration.ofHours(2), T0)).ban().orElseThrow();

    assertThat(ban.remaining(T0.plus(Duration.ofHours(1)))).contains(Duration.ofHours(1));
    assertThat(ban.remaining(T0.plus(Duration.ofHours(3)))).contains(Duration.ZERO);
    assertThat(replay(ban(T0)).ban().orElseThrow().remaining(T0)).isEmpty();
  }

  @Test
  void entriesValidateReasonAndExpiry() {
    assertThatThrownBy(
            () ->
                AuditEntry.of(
                    GRIEFER, ModerationAction.KICK, STAFF, AuditEntry.Term.permanent(" ", T0)))
        .isInstanceOf(IllegalArgumentException.class);
    var longReason = "x".repeat(AuditEntry.MAX_REASON_LENGTH + 1);
    assertThatThrownBy(
            () ->
                AuditEntry.of(
                    GRIEFER,
                    ModerationAction.KICK,
                    STAFF,
                    AuditEntry.Term.permanent(longReason, T0)))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> entry(ModerationAction.KICK, Optional.of(Duration.ofHours(1)), T0))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(
            () -> new AuditEntry(GRIEFER, ModerationAction.BAN, STAFF, "x", T0, Optional.of(T0)))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new AuditEntry.Term(Optional.of(Duration.ZERO), "x", T0))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void termsComputeTheirExpiry() {
    assertThat(new AuditEntry.Term(Optional.of(Duration.ofDays(1)), "x", T0).expiry())
        .contains(T0.plus(Duration.ofDays(1)));
    assertThat(AuditEntry.Term.permanent("x", T0).expiry()).isEmpty();
  }

  @Test
  void theConsoleIsAnActorWithoutAPlayer() {
    assertThat(Actor.CONSOLE.uuid()).isEmpty();
    assertThatThrownBy(() -> new Actor(Optional.empty(), " "))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
