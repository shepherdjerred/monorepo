package com.shepherdjerred.thestorm.messages.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.Set;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

final class PreferencesAndBlocklistTest {

  private static final CommandBlocklist BLOCKLIST =
      new CommandBlocklist(Set.of("pl", "plugins", "ver", "version", "help", "?"));

  @Test
  void everyoneHearsEverythingByDefault() {
    var preferences = AnnouncementPreferences.hearingEverything();

    assertThat(preferences.hears(Channel.TIPS)).isTrue();
    assertThat(preferences.hears(Channel.ADS)).isTrue();
  }

  @Test
  void toggleMutesOneChannelAndTogglingAgainUnmutes() {
    var muted = AnnouncementPreferences.hearingEverything().toggle(Channel.TIPS);

    assertThat(muted.hears(Channel.TIPS)).isFalse();
    assertThat(muted.hears(Channel.ADS)).isTrue();
    assertThat(muted.toggle(Channel.TIPS)).isEqualTo(AnnouncementPreferences.hearingEverything());
  }

  @Test
  void channelsToggleIndependently() {
    var both = AnnouncementPreferences.hearingEverything().toggle(Channel.TIPS).toggle(Channel.ADS);

    assertThat(both.muted()).containsExactlyInAnyOrder(Channel.TIPS, Channel.ADS);
    assertThat(both.toggle(Channel.ADS).muted()).containsExactly(Channel.TIPS);
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "/ pl",
        "/?",
        "/bukkit:help",
        "/bukkit:pl",
        "/help",
        "/help 2",
        "/PL",
        "/pl",
        "/plugins",
        "/ver",
        "/version foo"
      })
  void blocksListedCommands(String message) {
    assertThat(BLOCKLIST.blocksMessage(message)).isTrue();
  }

  @ParameterizedTest
  @ValueSource(strings = {"/", "/bal pl", "/helpop", "/plot", "/toggle-tips", "/verify"})
  void allowsEverythingElse(String message) {
    assertThat(BLOCKLIST.blocksMessage(message)).isFalse();
  }

  @Test
  void blocksNamespacedLabelsSentToTheClient() {
    assertThat(BLOCKLIST.blocks("bukkit:plugins")).isTrue();
    assertThat(BLOCKLIST.blocks("minecraft:help")).isTrue();
    assertThat(BLOCKLIST.blocks("minecraft:tell")).isFalse();
  }

  @Test
  void hidesBlockedAndNamespacedCommandsFromTheClient() {
    assertThat(BLOCKLIST.hidesFromClient("plugins")).isTrue();
    assertThat(BLOCKLIST.hidesFromClient("help")).isTrue();
    assertThat(BLOCKLIST.hidesFromClient("worldedit:wand")).isTrue();
    assertThat(BLOCKLIST.hidesFromClient("minecraft:tell")).isTrue();
    assertThat(BLOCKLIST.hidesFromClient("thestorm:toggle-tips")).isTrue();
    assertThat(BLOCKLIST.hidesFromClient("tell")).isFalse();
    assertThat(BLOCKLIST.hidesFromClient("toggle-tips")).isFalse();
  }

  @ParameterizedTest
  @ValueSource(strings = {"", "/pl", "bukkit:pl", "PL", "pl ugins"})
  void rejectsMalformedLabels(String label) {
    assertThatThrownBy(() -> new CommandBlocklist(Set.of(label)))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
