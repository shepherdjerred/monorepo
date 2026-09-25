package com.shepherdjerred.thestorm.chat.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.result.Result;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;

final class ChatProfileTest {

  private static final UUID SELF = UUID.fromString("00000000-0000-0000-0000-000000000001");
  private static final UUID OTHER = UUID.fromString("00000000-0000-0000-0000-000000000002");

  private static <T, E> T ok(Result<T, E> result) {
    return switch (result) {
      case Result.Ok<T, E>(var value) -> value;
      case Result.Err<T, E>(var error) -> throw new AssertionError("expected ok, got " + error);
    };
  }

  @Test
  void freshProfileListensEverywhere() {
    var profile = ChatProfile.fresh(ChannelKey.GLOBAL);

    assertThat(profile.focus()).isEqualTo(ChannelKey.GLOBAL);
    assertThat(ChannelKey.values()).allMatch(profile::receives);
    assertThat(profile.ignored()).isEmpty();
  }

  @Test
  void cannotHideTheFocusedChannel() {
    var profile = ChatProfile.fresh(ChannelKey.GLOBAL);

    assertThat(profile.hide(ChannelKey.GLOBAL))
        .isEqualTo(Result.err(ProfileError.CANNOT_HIDE_FOCUSED));
    assertThatThrownBy(() -> new ChatProfile(ChannelKey.WAR, Set.of(ChannelKey.WAR), Map.of()))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void hidesAndShowsChannels() {
    var hidden = ok(ChatProfile.fresh(ChannelKey.GLOBAL).hide(ChannelKey.WAR));

    assertThat(hidden.receives(ChannelKey.WAR)).isFalse();
    assertThat(hidden.hide(ChannelKey.WAR)).isEqualTo(Result.err(ProfileError.ALREADY_HIDDEN));
    assertThat(ok(hidden.show(ChannelKey.WAR)).receives(ChannelKey.WAR)).isTrue();
    assertThat(hidden.show(ChannelKey.STAFF)).isEqualTo(Result.err(ProfileError.NOT_HIDDEN));
  }

  @Test
  void focusingAHiddenChannelShowsIt() {
    var hidden = ok(ChatProfile.fresh(ChannelKey.GLOBAL).hide(ChannelKey.WAR));

    var focused = hidden.focusOn(ChannelKey.WAR);

    assertThat(focused.focus()).isEqualTo(ChannelKey.WAR);
    assertThat(focused.receives(ChannelKey.WAR)).isTrue();
  }

  @Test
  void ignoresAndUnignoresPlayers() {
    var profile =
        ok(
            ChatProfile.fresh(ChannelKey.GLOBAL)
                .ignore(SELF, new ChatProfile.IgnoreTarget(OTHER, "Griefer", false)));

    assertThat(profile.ignores(OTHER)).isTrue();
    assertThat(profile.ignoredNamed("griefer")).contains(OTHER);
    assertThat(profile.ignoredNamed("nobody")).isEmpty();
    assertThat(profile.ignore(SELF, new ChatProfile.IgnoreTarget(OTHER, "Griefer", false)))
        .isEqualTo(Result.err(ProfileError.ALREADY_IGNORED));
    assertThat(ok(profile.unignore(OTHER)).ignores(OTHER)).isFalse();
    assertThat(ChatProfile.fresh(ChannelKey.GLOBAL).unignore(OTHER))
        .isEqualTo(Result.err(ProfileError.NOT_IGNORED));
  }

  @Test
  void cannotIgnoreSelfOrStaff() {
    var profile = ChatProfile.fresh(ChannelKey.GLOBAL);

    assertThat(profile.ignore(SELF, new ChatProfile.IgnoreTarget(SELF, "Me", false)))
        .isEqualTo(Result.err(ProfileError.CANNOT_IGNORE_SELF));
    assertThat(profile.ignore(SELF, new ChatProfile.IgnoreTarget(OTHER, "Mod", true)))
        .isEqualTo(Result.err(ProfileError.CANNOT_IGNORE_STAFF));
  }

  @Test
  void profilesAreImmutable() {
    var original = ChatProfile.fresh(ChannelKey.GLOBAL);

    var unused = original.hide(ChannelKey.WAR);

    assertThat(unused.isOk()).isTrue();
    assertThat(original.receives(ChannelKey.WAR)).isTrue();
  }

  @Test
  void channelIdsRoundTrip() {
    for (var key : ChannelKey.values()) {
      assertThat(ChannelKey.fromId(key.id())).contains(key);
    }
    assertThat(ChannelKey.fromId("GLOBAL")).isEmpty();
    assertThat(ChannelKey.GLOBAL.reach()).isEqualTo(ChannelKey.Reach.EVERYONE);
    assertThat(ChannelKey.WAR.reach()).isEqualTo(ChannelKey.Reach.EVERYONE);
    assertThat(ChannelKey.STAFF.reach()).isEqualTo(ChannelKey.Reach.STAFF);
    assertThat(ChannelKey.TOWN.reach()).isEqualTo(ChannelKey.Reach.TOWN);
    assertThat(ChannelKey.fromId("nation")).as("there are no nations").isEmpty();
  }
}
