package com.shepherdjerred.thestorm.essentials.adapter.paper;

import com.shepherdjerred.thestorm.core.text.HouseStyle;
import net.kyori.adventure.audience.Audience;
import net.kyori.adventure.text.Component;

/** Sends house-style messages. Labels are fixed UI text. */
final class Say {

  static final String TELEPORT = "Teleport";
  static final String HOMES = "Homes";
  static final String WARPS = "Warps";
  static final String KITS = "Kits";
  static final String AFK = "AFK";
  static final String MODERATION = "Moderation";
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
