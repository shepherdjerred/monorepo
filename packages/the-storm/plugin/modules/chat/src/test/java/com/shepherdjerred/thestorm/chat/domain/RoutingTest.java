package com.shepherdjerred.thestorm.chat.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;

final class RoutingTest {

  private static final UUID SPEAKER = UUID.fromString("00000000-0000-0000-0000-000000000001");
  private static final UUID VIEWER = UUID.fromString("00000000-0000-0000-0000-000000000002");
  private static final ChatProfile LISTENS = ChatProfile.fresh(ChannelKey.GLOBAL);

  private static Routing.Viewer viewer(boolean staff, ChatProfile profile) {
    return new Routing.Viewer(VIEWER, staff, profile);
  }

  @Test
  void openChannelsReachEveryone() {
    assertThat(Routing.receives(ChannelKey.GLOBAL, SPEAKER, viewer(false, LISTENS), Set.of()))
        .isTrue();
    assertThat(Routing.receives(ChannelKey.WAR, SPEAKER, viewer(false, LISTENS), Set.of()))
        .isTrue();
  }

  @Test
  void staffChatReachesOnlyStaff() {
    assertThat(Routing.receives(ChannelKey.STAFF, SPEAKER, viewer(false, LISTENS), Set.of()))
        .isFalse();
    assertThat(Routing.receives(ChannelKey.STAFF, SPEAKER, viewer(true, LISTENS), Set.of()))
        .isTrue();
  }

  @Test
  void townChatReachesOnlyTheTown() {
    assertThat(
            Routing.receives(
                ChannelKey.TOWN, SPEAKER, viewer(false, LISTENS), Set.of(SPEAKER, VIEWER)))
        .isTrue();
    assertThat(Routing.receives(ChannelKey.TOWN, SPEAKER, viewer(true, LISTENS), Set.of(SPEAKER)))
        .as("staff outside the town do not hear it")
        .isFalse();
  }

  @Test
  void hiddenChannelsAreNotReceived() {
    var profile = new ChatProfile(ChannelKey.GLOBAL, Set.of(ChannelKey.WAR), Map.of());

    assertThat(Routing.receives(ChannelKey.WAR, SPEAKER, viewer(false, profile), Set.of()))
        .isFalse();
    assertThat(Routing.receivesExternal(viewer(false, profile))).isTrue();

    var noGlobal = new ChatProfile(ChannelKey.WAR, Set.of(ChannelKey.GLOBAL), Map.of());
    assertThat(Routing.receivesExternal(viewer(false, noGlobal))).isFalse();
  }

  @Test
  void ignoredSpeakersAreNotReceivedExceptInStaffChat() {
    var profile = new ChatProfile(ChannelKey.GLOBAL, Set.of(), Map.of(SPEAKER, "Speaker"));

    assertThat(Routing.receives(ChannelKey.GLOBAL, SPEAKER, viewer(true, profile), Set.of()))
        .isFalse();
    assertThat(Routing.receives(ChannelKey.STAFF, SPEAKER, viewer(true, profile), Set.of()))
        .isTrue();
  }

  @Test
  void speakersAlwaysSeeTheirOwnMessage() {
    var profile = new ChatProfile(ChannelKey.GLOBAL, Set.of(ChannelKey.WAR), Map.of());
    var self = new Routing.Viewer(SPEAKER, false, profile);

    assertThat(Routing.receives(ChannelKey.WAR, SPEAKER, self, Set.of())).isTrue();
    assertThat(Routing.receives(ChannelKey.STAFF, SPEAKER, self, Set.of())).isTrue();
  }
}
