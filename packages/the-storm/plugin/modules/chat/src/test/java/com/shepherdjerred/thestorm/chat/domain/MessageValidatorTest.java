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
  private static final String SECTION = String.valueOf((char) 0xA7);
  private static final Speaker PLAYER =
      new Speaker(UUID.fromString("00000000-0000-0000-0000-000000000001"), "Jerred", false, false);
  private static final Speaker BYPASS =
      new Speaker(UUID.fromString("00000000-0000-0000-0000-000000000002"), "Mod", true, true);
  private static final FilterSettings SETTINGS = new FilterSettings(40, 2, 30);

  private final MessageValidator validator = MessageValidator.standard(SETTINGS);

  private Result<AcceptedMessage, List<ChatDenial>> send(
      Speaker speaker, String text, ChatFacts facts) {
    return validator.validate(new ChatAttempt(speaker, text, NOW), facts);
  }

  private static ChatFacts facts(@Nullable Mute mute, @Nullable RecentMessage last) {
    return new ChatFacts(mute, last);
  }

  private static Result<AcceptedMessage, List<ChatDenial>> accepted(String text, boolean calmed) {
    return Result.ok(new AcceptedMessage(text, NOW, calmed));
  }

  @Test
  void acceptsAndCleansAnOrdinaryMessage() {
    assertThat(send(PLAYER, "  hello\n  world " + SECTION + "c", ChatFacts.NONE))
        .isEqualTo(accepted("hello world", false));
  }

  @Test
  void rejectsBlankMessages() {
    assertThat(send(PLAYER, " " + SECTION + "l ", ChatFacts.NONE))
        .isEqualTo(Result.err(List.of(new ChatDenial.Blank())));
  }

  @Test
  void rejectsLongMessagesByCodePoints() {
    var emoji = Character.toString(0x1F600);

    assertThat(send(PLAYER, "x".repeat(40), ChatFacts.NONE).isOk()).isTrue();
    assertThat(send(PLAYER, emoji.repeat(40), ChatFacts.NONE).isOk()).isTrue();
    assertThat(send(PLAYER, "x".repeat(41), ChatFacts.NONE))
        .isEqualTo(Result.err(List.of(new ChatDenial.TooLong(40))));
  }

  @Test
  void calmsShoutingInsteadOfBlockingIt() {
    assertThat(send(PLAYER, "I SAID OK then", ChatFacts.NONE))
        .as("two caps words are allowed")
        .isEqualTo(accepted("I SAID OK then", false));
    assertThat(send(PLAYER, "WHY IS THIS Jerred", ChatFacts.NONE))
        .isEqualTo(accepted("why is this Jerred", true));
    assertThat(send(PLAYER, "A B C D E", ChatFacts.NONE))
        .as("single letters are not shouting")
        .isEqualTo(accepted("A B C D E", false));
    assertThat(send(PLAYER, "LOL?! OMG!! WOW", ChatFacts.NONE))
        .isEqualTo(accepted("lol?! omg!! wow", true));
    assertThat(send(BYPASS, "STAFF CAN SHOUT", ChatFacts.NONE))
        .isEqualTo(accepted("STAFF CAN SHOUT", false));
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
  void aCalmedRepeatIsStillARepeat() {
    var last = RecentMessage.of("buy my stuff now please", NOW.minusSeconds(5));

    assertThat(send(PLAYER, "BUY MY STUFF NOW please", facts(null, last)).isOk()).isFalse();
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
  void collectsEveryDenial() {
    var mute = Mute.starting(NOW, Duration.ofMinutes(1), "spam", "Mod");

    assertThat(send(PLAYER, "x".repeat(41), facts(mute, null)))
        .isEqualTo(
            Result.err(
                List.of(
                    new ChatDenial.Muted(Duration.ofMinutes(1), "spam"),
                    new ChatDenial.TooLong(40))));
  }

  @Test
  void noAccessIsNeverGranted() {
    assertThatThrownBy(() -> new ChatDenial.NoAccess(ChannelKey.TOWN, ChannelAccess.GRANTED))
        .isInstanceOf(IllegalArgumentException.class);
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

  @Test
  void shoutingCountsOnlyWordsWithTwoCapitalLetters() {
    assertThat(Shouting.capsWords("I AM OK a-B CD1 x")).isEqualTo(3);
    assertThat(Shouting.calm("KEEP  SPACES Here", 1)).isEqualTo("keep  spaces Here");
    assertThat(Shouting.calm("ONLY ONE", 2)).isEqualTo("ONLY ONE");
  }
}
