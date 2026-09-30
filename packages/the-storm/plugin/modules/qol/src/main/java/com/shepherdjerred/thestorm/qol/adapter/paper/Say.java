package com.shepherdjerred.thestorm.qol.adapter.paper;

import com.shepherdjerred.thestorm.core.text.HouseStyle;
import net.kyori.adventure.audience.Audience;
import net.kyori.adventure.text.Component;

/** Sends house-style messages. Labels are fixed UI text. */
final class Say {

  static final String GRAVES = "Graves";
  static final String COMBAT = "Combat";
  static final String SLEEP = "Sleep";
  static final String SORT = "Sort";
  static final String STORM = "The Storm";

  private Say() {}

  static void info(Audience to, String label, String message) {
    to.sendMessage(HouseStyle.info(label, Component.text(message)));
  }

  static void success(Audience to, String label, String message) {
    to.sendMessage(HouseStyle.success(label, Component.text(message)));
  }

  static void error(Audience to, String label, String message) {
    to.sendMessage(HouseStyle.error(label, Component.text(message)));
  }
}
