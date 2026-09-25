package com.shepherdjerred.thestorm.qol.adapter.paper;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;

/** Short player-facing lines. */
final class Messages {

  private Messages() {}

  static Component info(String text) {
    return Component.text(text, NamedTextColor.GRAY);
  }

  static Component error(String text) {
    return Component.text(text, NamedTextColor.RED);
  }
}
