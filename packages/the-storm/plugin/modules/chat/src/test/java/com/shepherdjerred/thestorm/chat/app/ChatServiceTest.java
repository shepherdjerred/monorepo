package com.shepherdjerred.thestorm.chat.app;

import static com.shepherdjerred.thestorm.chat.app.Fixtures.ALICE;
import static com.shepherdjerred.thestorm.chat.app.Fixtures.ALICE_SPEAKS;
import static com.shepherdjerred.thestorm.chat.app.Fixtures.BOB;
import static com.shepherdjerred.thestorm.chat.app.Fixtures.CAROL;
import static com.shepherdjerred.thestorm.chat.app.Fixtures.CONFIG;
import static com.shepherdjerred.thestorm.chat.app.Fixtures.STAFF_SPEAKS;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.chat.domain.ChannelAccess;
import com.shepherdjerred.thestorm.chat.domain.ChannelKey;
import com.shepherdjerred.thestorm.chat.domain.ChatDenial;
import com.shepherdjerred.thestorm.chat.domain.ChatProfile;
import com.shepherdjerred.thestorm.chat.domain.Mute;
import com.shepherdjerred.thestorm.chat.domain.ProfileError;
import com.shepherdjerred.thestorm.core.result.Result;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import org.junit.jupiter.api.Test;

final class ChatServiceTest {

  private final Fixtures.Clock clock = new Fixtures.Clock();
  private final Fixtures.RecordingStore store = new Fixtures.RecordingStore();
  private final ChatExtensions extensions = new ChatExtensions();
  private final ChatService service = new ChatService(CONFIG, store, clock, extensions);

  private OutgoingLine sent(Result<OutgoingLine, List<ChatDenial>> result) {
    return switch (result) {
      case Result.Ok<OutgoingLine, List<ChatDenial>>(var line) -> line;
      case Result.Err<OutgoingLine, List<ChatDenial>>(var denials) ->
          throw new AssertionError("expected the message to send, got " + denials);
    };
  }

  @Test
  void newPlayersTalkInTheDefaultChannel() {
    assertThat(service.profile(ALICE)).isEqualTo(ChatProfile.fresh(ChannelKey.GLOBAL));
    assertThat(store.writes).isEmpty();
  }

  @Test
  void focusIsRememberedAndStored() {
    assertThat(service.focus(ALICE_SPEAKS, ChannelKey.WAR).isOk()).isTrue();

    assertThat(service.profile(ALICE).focus()).isEqualTo(ChannelKey.WAR);
    assertThat(store.profiles.get(ALICE)).isEqualTo(service.profile(ALICE));
  }

  @Test
  void staffChatNeedsStaff() {
    assertThat(service.focus(ALICE_SPEAKS, ChannelKey.STAFF))
        .isEqualTo(
            Result.err(new ChatDenial.NoAccess(ChannelKey.STAFF, ChannelAccess.NO_PERMISSION)));
    assertThat(service.focus(STAFF_SPEAKS, ChannelKey.STAFF).isOk()).isTrue();
  }

  @Test
  void townChatIsUnavailableUntilTownsRegister() {
    assertThat(service.access(ALICE_SPEAKS, ChannelKey.TOWN)).isEqualTo(ChannelAccess.UNAVAILABLE);
    assertThat(service.prepare(ALICE_SPEAKS, ChannelKey.TOWN, "hi"))
        .isEqualTo(
            Result.err(
                List.of(new ChatDenial.NoAccess(ChannelKey.TOWN, ChannelAccess.UNAVAILABLE))));

    extensions.registerTownMembership(
        speaker -> speaker.equals(ALICE) ? Optional.of(Set.of(ALICE, BOB)) : Optional.empty());

    assertThat(service.access(ALICE_SPEAKS, ChannelKey.TOWN)).isEqualTo(ChannelAccess.GRANTED);
    assertThat(service.access(STAFF_SPEAKS, ChannelKey.TOWN)).isEqualTo(ChannelAccess.NOT_A_MEMBER);
  }

  @Test
  void townLinesReachOnlyTheTown() {
    extensions.registerTownMembership(speaker -> Optional.of(Set.of(ALICE, BOB)));

    var line = sent(service.prepare(ALICE_SPEAKS, ChannelKey.TOWN, "meet at the hall"));

    assertThat(line.members()).containsExactlyInAnyOrder(ALICE, BOB);
    assertThat(service.receives(line, BOB, false)).isTrue();
    assertThat(service.receives(line, CAROL, true)).isFalse();
  }

  @Test
  void ignoresAndHiddenChannelsShapeDelivery() {
    service.ignore(BOB, new ChatProfile.IgnoreTarget(ALICE, "Alice", false));
    var line = sent(service.prepare(ALICE_SPEAKS, ChannelKey.GLOBAL, "hello"));

    assertThat(service.receives(line, BOB, false)).isFalse();
    assertThat(service.receives(line, CAROL, false)).isTrue();

    assertThat(service.hide(CAROL, ChannelKey.GLOBAL))
        .isEqualTo(Result.err(ProfileError.CANNOT_HIDE_FOCUSED));
    service.focus(STAFF_SPEAKS, ChannelKey.WAR);
    assertThat(service.hide(CAROL, ChannelKey.GLOBAL).isOk()).isTrue();
    assertThat(service.receives(line, CAROL, true)).isFalse();
    assertThat(service.receivesExternal(CAROL, true)).isFalse();
    assertThat(service.show(CAROL, ChannelKey.GLOBAL).isOk()).isTrue();
    assertThat(service.receivesExternal(CAROL, true)).isTrue();

    assertThat(service.unignore(BOB, ALICE).isOk()).isTrue();
    assertThat(service.receives(line, BOB, false)).isTrue();
    assertThat(store.profiles).containsEntry(BOB, service.profile(BOB));
    assertThat(service.profile(BOB).ignored()).isEmpty();
  }

  @Test
  void failedChangesAreNotStored() {
    assertThat(service.show(ALICE, ChannelKey.WAR)).isEqualTo(Result.err(ProfileError.NOT_HIDDEN));
    assertThat(store.writes).isEmpty();
  }

  @Test
  void mutesExpireWithTime() {
    service.mute(ALICE, Duration.ofMinutes(5), "spam", "Carol");

    assertThat(service.prepare(ALICE_SPEAKS, ChannelKey.GLOBAL, "let me talk"))
        .isEqualTo(Result.err(List.of(new ChatDenial.Muted(Duration.ofMinutes(5), "spam"))));
    assertThat(store.mutes).containsKey(ALICE);

    clock.advance(Duration.ofMinutes(5));

    assertThat(service.activeMute(ALICE)).isEmpty();
    assertThat(service.prepare(ALICE_SPEAKS, ChannelKey.GLOBAL, "let me talk").isOk()).isTrue();
  }

  @Test
  void unmuteLiftsOnlyActiveMutes() {
    assertThat(service.unmute(ALICE)).isFalse();

    service.mute(ALICE, Duration.ofMinutes(5), "spam", "Carol");

    assertThat(service.activeMute(ALICE)).map(Mute::issuer).contains("Carol");
    assertThat(service.unmute(ALICE)).isTrue();
    assertThat(store.mutes).isEmpty();
    assertThat(service.prepare(ALICE_SPEAKS, ChannelKey.GLOBAL, "thanks").isOk()).isTrue();
  }

  @Test
  void repeatsAreBlockedUntilTheCooldownPasses() {
    assertThat(service.prepare(ALICE_SPEAKS, ChannelKey.GLOBAL, "selling dirt").isOk()).isTrue();

    clock.advance(Duration.ofSeconds(10));
    assertThat(service.prepare(ALICE_SPEAKS, ChannelKey.WAR, "Selling dirt"))
        .isEqualTo(Result.err(List.of(new ChatDenial.Repeated(Duration.ofSeconds(20)))));

    clock.advance(Duration.ofSeconds(20));
    assertThat(service.prepare(ALICE_SPEAKS, ChannelKey.GLOBAL, "selling dirt").isOk()).isTrue();
  }

  @Test
  void loadingKeepsChangesMadeBeforeItFinished() {
    service.focus(ALICE_SPEAKS, ChannelKey.WAR);
    store.snapshot =
        new ChatSnapshot(
            Map.of(
                ALICE, ChatProfile.fresh(ChannelKey.GLOBAL),
                BOB, ChatProfile.fresh(ChannelKey.WAR)),
            Map.of(BOB, Mute.starting(clock.instant(), Duration.ofHours(1), "grief", "Carol")));

    service.load().join();

    assertThat(service.profile(ALICE).focus()).isEqualTo(ChannelKey.WAR);
    assertThat(service.profile(BOB).focus()).isEqualTo(ChannelKey.WAR);
    assertThat(service.activeMute(BOB)).isPresent();
  }

  @Test
  void rendersWithThePrefixProviderAndEscapes() {
    var line = sent(service.prepare(ALICE_SPEAKS, ChannelKey.GLOBAL, "<red>hi"));

    assertThat(service.render(line)).isEqualTo("[G][Alice]: \\<red>hi");

    extensions.registerPrefixProvider(player -> "<gold>Mage</gold>");

    assertThat(service.render(line)).isEqualTo("[G][<gold>Mage</gold> Alice]: \\<red>hi");
    assertThat(service.renderExternal("D", "<b>bob", "yo\n§kthere"))
        .isEqualTo("[D][\\<b>bob]: yo there");
  }

  @Test
  void channelsListsStanding() {
    var channels = service.channels(ALICE_SPEAKS);

    assertThat(channels).hasSize(ChannelKey.values().length);
    assertThat(channels.getFirst())
        .isEqualTo(new ChannelStatus(ChannelKey.GLOBAL, ChannelAccess.GRANTED, true, false));
    assertThat(channels)
        .filteredOn(status -> status.channel() == ChannelKey.STAFF)
        .singleElement()
        .extracting(ChannelStatus::access)
        .isEqualTo(ChannelAccess.NO_PERMISSION);
  }

  @Test
  void extensionsRegisterOnce() {
    extensions.registerTownMembership(speaker -> Optional.empty());
    extensions.registerPrefixProvider(player -> "x");

    assertThatThrownBy(() -> extensions.registerTownMembership(speaker -> Optional.empty()))
        .isInstanceOf(IllegalStateException.class);
    assertThatThrownBy(() -> extensions.registerPrefixProvider(player -> "y"))
        .isInstanceOf(IllegalStateException.class);
  }
}
