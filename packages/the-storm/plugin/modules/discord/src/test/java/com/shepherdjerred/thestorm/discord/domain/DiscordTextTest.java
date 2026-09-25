package com.shepherdjerred.thestorm.discord.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

/** Invisible characters are built from code points so the source stays readable. */
final class DiscordTextTest {

  private static final String ZWSP = String.valueOf((char) 0x200B);
  private static final String SECTION = String.valueOf((char) 0xA7);
  private static final String ELLIPSIS = String.valueOf((char) 0x2026);

  @Test
  void escapesMarkdownAnywhere() {
    assertThat(DiscordText.forDiscord("**bold** _it_ ~~s~~ `code` ||spoiler|| a\\b"))
        .isEqualTo("\\*\\*bold\\*\\* \\_it\\_ \\~\\~s\\~\\~ \\`code\\` \\|\\|spoiler\\|\\| a\\\\b");
    assertThat(DiscordText.forDiscord("[click](https://evil.example)"))
        .isEqualTo("\\[click\\](https://evil.example)");
  }

  @Test
  void escapesLineStartSyntaxOnlyAtTheStart() {
    assertThat(DiscordText.forDiscord("# big")).isEqualTo("\\# big");
    assertThat(DiscordText.forDiscord("> quote")).isEqualTo("\\> quote");
    assertThat(DiscordText.forDiscord("- item")).isEqualTo("\\- item");
    assertThat(DiscordText.forDiscord("1. first")).isEqualTo("1\\. first");
    assertThat(DiscordText.forDiscord("well-known #1 > 2.5")).isEqualTo("well-known #1 > 2.5");
  }

  @Test
  void neutralizesMentions() {
    var everyone = "@" + ZWSP + "everyone look";
    var here = "hi @" + ZWSP + "here";
    var ids = "\\<@" + ZWSP + "123456789> \\<@" + ZWSP + "&42> \\<#7>";

    assertThat(DiscordText.forDiscord("@everyone look")).isEqualTo(everyone);
    assertThat(DiscordText.forDiscord("hi @here")).isEqualTo(here);
    assertThat(DiscordText.forDiscord("<@123456789> <@&42> <#7>")).isEqualTo(ids);
  }

  @Test
  void stripsMinecraftFormattingAndControlCharacters() {
    assertThat(DiscordText.forDiscord(SECTION + "cRed " + SECTION + "lbold\nline"))
        .isEqualTo("Red bold line");
    assertThat(DiscordText.clean("a" + (char) 0x202E + "b" + (char) 0x07)).isEqualTo("ab");
  }

  @Test
  void flattensDiscordTextForTheGame() {
    assertThat(DiscordText.fromDiscord("hello <:pepe:123456789012> <a:dance:42>"))
        .isEqualTo("hello :pepe: :dance:");
    assertThat(DiscordText.fromDiscord("**bold** __under__ ~~gone~~ ||secret|| `code`"))
        .isEqualTo("bold under gone secret code");
    assertThat(DiscordText.fromDiscord("line one\nline two\n\n  three"))
        .isEqualTo("line one line two three");
    assertThat(DiscordText.fromDiscord("not \\*bold\\* " + SECTION + "4red"))
        .isEqualTo("not *bold* red");
  }

  @Test
  void keepsGameMarkupForChatToEscape() {
    assertThat(DiscordText.fromDiscord("<red>hi</red>")).isEqualTo("<red>hi</red>");
  }

  @Test
  void truncatesByCodePoints() {
    assertThat(DiscordText.truncate("hello", 5)).isEqualTo("hello");
    var cut = "hell" + ELLIPSIS;
    var emoji = Character.toString(0x1F600);
    var cutEmoji = emoji + ELLIPSIS;

    assertThat(DiscordText.truncate("hello!", 5)).isEqualTo(cut);
    assertThat(DiscordText.truncate(emoji.repeat(3), 2)).isEqualTo(cutEmoji);
    assertThatThrownBy(() -> DiscordText.truncate("x", 0))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
