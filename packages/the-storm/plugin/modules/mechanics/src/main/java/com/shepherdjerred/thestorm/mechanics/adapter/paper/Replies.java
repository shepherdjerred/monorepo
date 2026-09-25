package com.shepherdjerred.thestorm.mechanics.adapter.paper;

import com.shepherdjerred.thestorm.core.text.HouseStyle;
import com.shepherdjerred.thestorm.mechanics.domain.sign.Feature;
import net.kyori.adventure.audience.Audience;
import net.kyori.adventure.text.Component;

/** House-style messages labelled with the feature they are about. */
final class Replies {

  private Replies() {}

  static void error(Audience to, Feature feature, Component message) {
    to.sendMessage(HouseStyle.error(feature.displayName(), message));
  }

  static void error(Audience to, Feature feature, String message) {
    error(to, feature, Component.text(message));
  }

  static void info(Audience to, Feature feature, String message) {
    to.sendMessage(HouseStyle.info(feature.displayName(), Component.text(message)));
  }

  static void success(Audience to, Feature feature, String message) {
    to.sendMessage(HouseStyle.success(feature.displayName(), Component.text(message)));
  }
}
