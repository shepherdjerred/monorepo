package com.shepherdjerred.thestorm.chat.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.result.Result;
import java.time.Duration;
import java.time.Instant;
import java.time.InstantSource;
import java.util.List;
import java.util.UUID;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.Test;

final class MessageValidatorTest {

  private static final Instant NOW = Instant.parse("2017-06-01T12:00:00Z");
  private static final Speaker PLAYER =
      new Speaker(UUID.fromString("00000000-0000-0000-0000-000000000001"), "Jerred", false, false);
  private static final Speaker BYPASS =
      new Speaker(UUID.fromString("00000000-0000-0000-0000-000000000002"), "Mod", true, true);
  private static final FilterSettings SETTINGS = new FilterSettings(40, 2, 30);
  private static final ChatFacts OPEN = new ChatFacts(ChannelAccess.GRANTED, null, null);

  private final MessageValidator validator = MessageValidator.standard(SETTINGS);

  private Result<String, List<ChatDenial>> send(Speaker speaker, String text, ChatFacts facts) {
    return validator.validate(new ChatAttempt(speaker, ChannelKey.GLOBAL, text, NOW), facts);
  }

  private static ChatFacts facts(@Nullable Mute mute, @Nullable RecentMessage last) {
    return new ChatFacts(ChannelAccess.GRANTED, mute, last);
  }

  @Test
  void acceptsAndCleansAnOrdinaryMessage() {
    assertThat(send(PLAYER, "  hello\n  world §c", OPEN)).isEqualTo(Result.ok("hello world"));
  }

  @Test
  void rejectsBlankMessages() {
    assertThat(send(PLAYER, " §l ", OPEN)).isEqualTo(Result.err(List.of(new ChatDenial.Blank())));
  }

  @Test
  void rejectsLongMessagesByCodePoints() {
    assertThat(send(PLAYER, "x".repeat(40), OPEN).isOk()).isTrue();
    assertThat(send(PLAYER, "😀".repeat(40), OPEN).isOk()).isTrue();
    assertThat(send(PLAYER, "x".repeat(41), OPEN))
        .isEqualTo(Result.err(List.of(new ChatDenial.TooLong(40))));
  }

  @Test
  void limitsCapsWords() {
    assertThat(send(PLAYER, "I SAID OK then", OPEN).isOk()).isTrue();
    assertThat(send(PLAYER, "WHY IS THIS", OPEN))
        .isEqualTo(Result.err(List.of(new ChatDenial.TooManyCaps(2))));
    assertThat(send(PLAYER, "A B C D E", OPEN).isOk())
        .as("single letters are not shouting")
        .isTrue();
    assertThat(send(PLAYER, "LOL?! OMG!! WOW", OPEN).isOk()).isFalse();
    assertThat(send(BYPASS, "STAFF CAN SHOUT", OPEN).isOk()).isTrue();
  }

  @Test
  void blocksRepeatsUntilTheCooldownEnds() {
    var last = RecentMessage.of("Buy my stuff", NOW.minusSeconds(10));

    assertThat(send(PLAYER, "buy  MY stuff", facts(null, last)))
        .isEqualTo(Result.err(List.of(new ChatDenial.Repeated(Duration.ofSeconds(20)))));
    assertThat(send(PLAYER, "something else", facts(null, last)).isOk()).isTrue();
    assertThat(send(BYPASS, "buy my stuff", facts(null, last)).isOk()).isTrue();

    var old = RecentMessage.of("Buy my stuff", NOW.minusSeconds(30));
    assertThat(send(PLAYER, "Buy my stuff", facts(null, old)).isOk()).isTrue();
  }

  @Test
  void mutedPlayersCannotTalkUntilTheMuteEnds() {
    var clock = InstantSource.fixed(NOW.minusSeconds(60));
    var mute = Mute.starting(clock.instant(), Duration.ofMinutes(5), "spam", "Mod");

    assertThat(send(PLAYER, "hi", facts(mute, null)))
        .isEqualTo(Result.err(List.of(new ChatDenial.Muted(Duration.ofMinutes(4), "spam"))));
    assertThat(send(BYPASS, "hi", facts(mute, null)).isOk()).as("staff are not exempt").isFalse();

    var expired = Mute.starting(NOW.minusSeconds(600), Duration.ofMinutes(5), "spam", "Mod");
    assertThat(send(PLAYER, "hi", facts(expired, null)).isOk()).isTrue();
  }

  @Test
  void refusesChannelsThePlayerCannotUse() {
    var facts = new ChatFacts(ChannelAccess.UNAVAILABLE, null, null);

    assertThat(validator.validate(new ChatAttempt(PLAYER, ChannelKey.TOWN, "hi", NOW), facts))
        .isEqualTo(
            Result.err(
                List.of(new ChatDenial.NoAccess(ChannelKey.TOWN, ChannelAccess.UNAVAILABLE))));
    assertThatThrownBy(() -> new ChatDenial.NoAccess(ChannelKey.TOWN, ChannelAccess.GRANTED))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void collectsEveryDenial() {
    var mute = Mute.starting(NOW, Duration.ofMinutes(1), "spam", "Mod");
    var facts = new ChatFacts(ChannelAccess.NO_PERMISSION, mute, null);

    var result =
        validator.validate(new ChatAttempt(PLAYER, ChannelKey.STAFF, "ONE TWO THREE", NOW), facts);

    assertThat(result)
        .isEqualTo(
            Result.err(
                List.of(
                    new ChatDenial.NoAccess(ChannelKey.STAFF, ChannelAccess.NO_PERMISSION),
                    new ChatDenial.Muted(Duration.ofMinutes(1), "spam"),
                    new ChatDenial.TooManyCaps(2))));
  }

  @Test
  void settingsValidateThemselves() {
    assertThatThrownBy(() -> new FilterSettings(0, 1, 1))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new FilterSettings(257, 1, 1))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new FilterSettings(10, -1, 1))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new FilterSettings(10, 1, -1))
        .isInstanceOf(IllegalArgumentException.class);
    assertThat(new FilterSettings(10, 0, 0).repeatCooldown()).isEqualTo(Duration.ZERO);
  }
}
