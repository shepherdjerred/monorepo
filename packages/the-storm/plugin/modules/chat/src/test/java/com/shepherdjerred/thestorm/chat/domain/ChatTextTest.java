package com.shepherdjerred.thestorm.chat.domain;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** Invisible characters are built from code points so the source stays readable. */
final class ChatTextTest {

  private static final String SECTION = String.valueOf((char) 0xA7);

  private static String chr(int codePoint) {
    return Character.toString(codePoint);
  }

  @Test
  void leavesOrdinaryTextAlone() {
    assertThat(ChatText.clean("hello")).isEqualTo("hello");
  }

  @Test
  void collapsesAndTrimsWhitespace() {
    assertThat(ChatText.clean("  hello   world  ")).isEqualTo("hello world");
    assertThat(ChatText.clean("tab\tand\nnewline")).isEqualTo("tab and newline");
    assertThat(ChatText.clean("non" + chr(0xA0) + "breaking")).isEqualTo("non breaking");
  }

  @Test
  void stripsLegacyFormattingCodes() {
    assertThat(ChatText.clean(SECTION + "ared" + SECTION + "r text")).isEqualTo("red text");
    assertThat(ChatText.clean("trailing section" + SECTION)).isEqualTo("trailing section");
  }

  @Test
  void stripsControlAndInvisibleCharacters() {
    assertThat(ChatText.clean("bell" + chr(0x07) + "char")).isEqualTo("bellchar");
    assertThat(ChatText.clean("zero" + chr(0x200B) + "width")).isEqualTo("zerowidth");
    assertThat(ChatText.clean("right" + chr(0x202E) + "to left")).isEqualTo("rightto left");
  }

  @Test
  void keepsEmojiAndAccents() {
    var text = "caf" + chr(0xE9) + " " + chr(0x1F600);

    assertThat(ChatText.clean(text)).isEqualTo(text);
  }

  @Test
  void keepsMarkupForTheFormatterToEscape() {
    assertThat(ChatText.clean("<red>hi</red> &4x")).isEqualTo("<red>hi</red> &4x");
  }

  @Test
  void blankBecomesEmpty() {
    assertThat(ChatText.clean(" \n\t" + SECTION + "l ")).isEmpty();
  }
}
