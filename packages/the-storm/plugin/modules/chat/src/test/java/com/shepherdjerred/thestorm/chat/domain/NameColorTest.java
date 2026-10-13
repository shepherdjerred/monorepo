package com.shepherdjerred.thestorm.chat.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.Optional;
import org.junit.jupiter.api.Test;

/** A speaker's name coloured per viewer, as a match's team colours ask. */
final class NameColorTest {

  private static final LineTemplate FORMAT =
      ChatFormat.channelTemplate("<prefix><player>: <message>");

  @Test
  void aNamedColourWrapsTheEscapedName() {
    var escaped = MiniMessageText.escape("Al<b>");

    var speech = new ChatFormat.Speech("", "Al<b>", "hi");

    assertThat(ChatFormat.channelLine(FORMAT, speech, Optional.of("dark_green")))
        .isEqualTo(String.join("", "<dark_green>", escaped, "</dark_green>: hi"));
    assertThat(ChatFormat.channelLine(FORMAT, speech, Optional.empty()))
        .isEqualTo(ChatFormat.channelLine(FORMAT, "", "Al<b>", "hi"));
  }

  @Test
  void onlyAColourNameIsAccepted() {
    assertThatThrownBy(() -> ChatFormat.colored("Al", Optional.of("red><click")))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
