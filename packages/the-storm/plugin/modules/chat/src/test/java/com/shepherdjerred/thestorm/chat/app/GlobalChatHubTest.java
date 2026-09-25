package com.shepherdjerred.thestorm.chat.app;

import static com.shepherdjerred.thestorm.chat.app.Fixtures.ALICE;
import static com.shepherdjerred.thestorm.chat.app.Fixtures.ALICE_SPEAKS;
import static com.shepherdjerred.thestorm.chat.app.Fixtures.CONFIG;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.chat.domain.ChannelKey;
import com.shepherdjerred.thestorm.chat.domain.ChatDenial;
import com.shepherdjerred.thestorm.core.result.Result;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

final class GlobalChatHubTest {

  private final Fixtures.Clock clock = new Fixtures.Clock();
  private final ChatService service =
      new ChatService(CONFIG, new Fixtures.RecordingStore(), clock, new ChatExtensions());
  private final List<String> delivered = new ArrayList<>();
  private final List<RuntimeException> failures = new ArrayList<>();
  private final GlobalChatHub hub =
      new GlobalChatHub(service, delivered::add, clock, failures::add);

  private OutgoingLine line(ChannelKey channel, String text) {
    return switch (service.prepare(ALICE_SPEAKS, channel, text)) {
      case Result.Ok<OutgoingLine, List<ChatDenial>>(var line) -> line;
      case Result.Err<OutgoingLine, List<ChatDenial>>(var denials) ->
          throw new AssertionError(denials.toString());
    };
  }

  @Test
  void publishesOnlyGlobalLines() {
    var lines = new ArrayList<ChatLine>();
    hub.subscribe(lines::add);

    hub.published(line(ChannelKey.WAR, "fight me"));
    hub.published(line(ChannelKey.GLOBAL, "hello"));

    assertThat(lines)
        .containsExactly(
            new ChatLine(clock.instant(), new ChatAuthor.InGame(ALICE, "Alice"), "hello"));
  }

  @Test
  void cancelledSubscriptionsStopReceiving() {
    var lines = new ArrayList<ChatLine>();
    var subscription = hub.subscribe(lines::add);

    subscription.cancel();
    hub.published(line(ChannelKey.GLOBAL, "hello"));

    assertThat(lines).isEmpty();
  }

  @Test
  void relaysExternalMessagesEscapedAndTellsListeners() {
    var lines = new ArrayList<ChatLine>();
    hub.subscribe(lines::add);

    hub.broadcastExternal("D", "bob", "  <red>hi\n");

    assertThat(delivered).containsExactly("[D][bob]: \\<red>hi");
    assertThat(lines)
        .containsExactly(
            new ChatLine(clock.instant(), new ChatAuthor.External("D", "bob"), "<red>hi"));
  }

  @Test
  void blankExternalMessagesAreABug() {
    assertThatThrownBy(() -> hub.broadcastExternal("D", "bob", " §a "))
        .isInstanceOf(IllegalArgumentException.class);
    assertThat(delivered).isEmpty();
  }

  @Test
  void aFailingListenerDoesNotStopTheOthers() {
    var lines = new ArrayList<ChatLine>();
    hub.subscribe(
        line -> {
          throw new IllegalStateException("bridge down");
        });
    hub.subscribe(lines::add);

    hub.published(line(ChannelKey.GLOBAL, "hello"));

    assertThat(lines).hasSize(1);
    assertThat(failures).singleElement().extracting(Throwable::getMessage).isEqualTo("bridge down");
  }
}
