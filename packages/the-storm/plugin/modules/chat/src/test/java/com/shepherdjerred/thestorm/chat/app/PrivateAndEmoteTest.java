package com.shepherdjerred.thestorm.chat.app;

import static com.shepherdjerred.thestorm.chat.app.Fixtures.ALICE;
import static com.shepherdjerred.thestorm.chat.app.Fixtures.ALICE_SPEAKS;
import static com.shepherdjerred.thestorm.chat.app.Fixtures.BOB;
import static com.shepherdjerred.thestorm.chat.app.Fixtures.CAROL;
import static com.shepherdjerred.thestorm.chat.app.Fixtures.CONFIG;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.chat.domain.ChannelKey;
import com.shepherdjerred.thestorm.chat.domain.ChatDenial;
import com.shepherdjerred.thestorm.chat.domain.ChatProfile;
import com.shepherdjerred.thestorm.chat.domain.Speaker;
import com.shepherdjerred.thestorm.core.result.Result;
import java.time.Duration;
import java.util.List;
import org.junit.jupiter.api.Test;

final class PrivateAndEmoteTest {

  private static final Correspondent TO_BOB = new Correspondent(BOB, "Bob");
  private static final Speaker BOB_SPEAKS = new Speaker(BOB, "Bob", false, false);

  private final Fixtures.Clock clock = new Fixtures.Clock();
  private final ChatService service =
      new ChatService(CONFIG, new Fixtures.RecordingStore(), clock, new ChatExtensions());

  private static <T> T ok(Result<T, List<ChatDenial>> result) {
    return switch (result) {
      case Result.Ok<T, List<ChatDenial>>(var value) -> value;
      case Result.Err<T, List<ChatDenial>>(var denials) ->
          throw new AssertionError("expected success, got " + denials);
    };
  }

  @Test
  void sendsAPrivateMessageRenderedForBoth() {
    var line = ok(service.preparePrivate(ALICE_SPEAKS, TO_BOB, "  meet <b>me</b>\n"));

    assertThat(line.message().text()).isEqualTo("meet <b>me</b>");
    assertThat(service.renderPrivate(line)).isEqualTo("[Alice -> Bob]: meet \\<b>me\\</b>");
  }

  @Test
  void repliesGoBackToTheLastCorrespondent() {
    assertThat(service.replyTarget(BOB)).isEmpty();

    ok(service.preparePrivate(ALICE_SPEAKS, TO_BOB, "hi bob"));

    assertThat(service.replyTarget(BOB)).contains(new Correspondent(ALICE, "Alice"));
    assertThat(service.replyTarget(ALICE)).contains(TO_BOB);
  }

  @Test
  void mutedPlayersCannotWhisper() {
    service.mute(ALICE, Duration.ofMinutes(5), "spam", "Carol");

    assertThat(service.preparePrivate(ALICE_SPEAKS, TO_BOB, "let me out"))
        .isEqualTo(Result.err(List.of(new ChatDenial.Muted(Duration.ofMinutes(5), "spam"))));
    assertThat(service.replyTarget(BOB)).isEmpty();
  }

  @Test
  void ignoredSendersAreToldOnlyThatItWasNotDelivered() {
    service.ignore(BOB, new ChatProfile.IgnoreTarget(ALICE, "Alice", false));

    assertThat(service.preparePrivate(ALICE_SPEAKS, TO_BOB, "hello?"))
        .isEqualTo(Result.err(List.of(new ChatDenial.Undeliverable())));
    assertThat(service.replyTarget(BOB)).as("an undelivered message opens no reply").isEmpty();
    assertThat(service.preparePrivate(BOB_SPEAKS, new Correspondent(ALICE, "Alice"), "hm").isOk())
        .as("the ignorer can still write")
        .isTrue();

    service.unignore(BOB, ALICE);
    assertThat(service.preparePrivate(ALICE_SPEAKS, TO_BOB, "hello?").isOk())
        .as("an undelivered message does not count as a repeat")
        .isTrue();
  }

  @Test
  void cannotMessageYourself() {
    assertThat(service.preparePrivate(ALICE_SPEAKS, new Correspondent(ALICE, "Alice"), "me"))
        .isEqualTo(Result.err(List.of(new ChatDenial.ToSelf())));
  }

  @Test
  void privateMessagesFollowTheFilters() {
    var calmed = ok(service.preparePrivate(ALICE_SPEAKS, TO_BOB, "WHY ARE YOU SO QUIET"));

    assertThat(calmed.message().calmed()).isTrue();
    assertThat(calmed.message().text()).isEqualTo("why are you so quiet");
    assertThat(service.capsNotice()).isEqualTo("Calm down");

    clock.advance(Duration.ofSeconds(1));
    assertThat(service.preparePrivate(ALICE_SPEAKS, TO_BOB, "why are you so quiet"))
        .isEqualTo(Result.err(List.of(new ChatDenial.Repeated(Duration.ofSeconds(29)))));
  }

  @Test
  void emotesGoToTheFocusedChannelAndStayInGame() {
    service.focus(ALICE_SPEAKS, ChannelKey.WAR);

    var line = ok(service.prepareEmote(ALICE_SPEAKS, "draws a <b>sword"));

    assertThat(line.channel()).isEqualTo(ChannelKey.WAR);
    assertThat(line.emote()).isTrue();
    assertThat(service.render(line)).isEqualTo("[W] * Alice draws a \\<b>sword");
    assertThat(service.receives(line, CAROL, false)).isTrue();
  }

  @Test
  void emotesNeedChannelAccess() {
    service.focus(new Speaker(ALICE, "Alice", true, false), ChannelKey.STAFF);

    assertThat(service.prepareEmote(ALICE_SPEAKS, "waves").isOk())
        .as("a player who lost staff cannot emote into staff chat")
        .isFalse();
  }
}
