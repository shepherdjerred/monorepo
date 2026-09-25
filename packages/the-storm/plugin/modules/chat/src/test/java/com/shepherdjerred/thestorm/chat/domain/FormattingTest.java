package com.shepherdjerred.thestorm.chat.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

final class FormattingTest {

  private static final String GLOBAL =
      "<dark_gray>[<dark_green>G</dark_green>][<prefix><white><player></white>]: </dark_gray>"
          + "<gray><message>";

  @Test
  void escapesTagOpenersAndBackslashes() {
    assertThat(MiniMessageText.escape("<red>a\\b</red>")).isEqualTo("\\<red>a\\\\b\\</red>");
    assertThat(MiniMessageText.escape("plain & simple > ok")).isEqualTo("plain & simple > ok");
  }

  @Test
  void templateRequiresEveryPlaceholder() {
    assertThatThrownBy(() -> ChatFormat.channelTemplate("<player>: <message>"))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("<prefix>");
    assertThatThrownBy(() -> ChatFormat.externalTemplate("<author>: <message>"))
        .hasMessageContaining("<source>");
  }

  @Test
  void templateRejectsMissingValues() {
    var template = new LineTemplate("<a> <b>", List.of("a", "b"));

    assertThatThrownBy(() -> template.render(Map.of("a", "x")))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void templateFillsInOnePassAndKeepsOtherTags() {
    var template = new LineTemplate("<gray><a> then <b> <unknown", List.of("a", "b"));

    assertThat(template.render(Map.of("a", "<b>", "b", "B")))
        .isEqualTo("<gray><b> then B <unknown");
  }

  @Test
  void rendersThe2017Line() {
    var line = ChatFormat.channelLine(ChatFormat.channelTemplate(GLOBAL), "", "Jerred", "hello");

    assertThat(line)
        .isEqualTo(
            "<dark_gray>[<dark_green>G</dark_green>][<white>Jerred</white>]: </dark_gray>"
                + "<gray>hello");
  }

  @Test
  void prefixIsTrustedAndSpaced() {
    var line =
        ChatFormat.channelLine(ChatFormat.channelTemplate(GLOBAL), "<gold>Mage</gold>", "J", "hi");

    assertThat(line).contains("[<gold>Mage</gold> <white>J</white>]");
  }

  @Test
  void playerTextCannotOpenTags() {
    var line =
        ChatFormat.channelLine(
            ChatFormat.channelTemplate(GLOBAL),
            "",
            "Evil<b>",
            "<click:run_command:'/op me'>free diamonds</click> <prefix> \\<red>");

    assertThat(line)
        .endsWith(
            "<gray>\\<click:run_command:'/op me'>free diamonds\\</click> \\<prefix> \\\\\\<red>")
        .contains("<white>Evil\\<b></white>");
  }

  @Test
  void externalValuesAreAllEscaped() {
    var line =
        ChatFormat.externalLine(
            ChatFormat.externalTemplate("[<source>] <author>: <message>"),
            "<D>",
            "<rainbow>bob",
            "<hover:show_text:x>hi");

    assertThat(line).isEqualTo("[\\<D>] \\<rainbow>bob: \\<hover:show_text:x>hi");
  }
}
