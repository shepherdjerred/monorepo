package com.shepherdjerred.thestorm.arena.adapter.paper;

import com.shepherdjerred.thestorm.arena.domain.config.Messages;
import com.shepherdjerred.thestorm.arena.domain.game.GameError;
import com.shepherdjerred.thestorm.arena.domain.game.Notice;
import com.shepherdjerred.thestorm.core.text.HouseStyle;
import net.kyori.adventure.audience.Audience;
import net.kyori.adventure.text.Component;

/** Renders the arena's messages in the house style. */
final class Texts {

  static final String LABEL = "Arena";

  private final Messages messages;

  Texts(Messages messages) {
    this.messages = messages;
  }

  void notice(Audience to, Notice notice) {
    var text = Component.text(messages.render(notice));
    to.sendMessage(
        switch (notice.kind().mood()) {
          case GOOD -> HouseStyle.success(LABEL, text);
          case BAD -> HouseStyle.error(LABEL, text);
          case NEUTRAL -> HouseStyle.info(LABEL, text);
        });
  }

  static void info(Audience to, String text) {
    to.sendMessage(HouseStyle.info(LABEL, Component.text(text)));
  }

  static void info(Audience to, Component text) {
    to.sendMessage(HouseStyle.info(LABEL, text));
  }

  static void error(Audience to, String text) {
    to.sendMessage(HouseStyle.error(LABEL, Component.text(text)));
  }

  static void error(Audience to, GameError error) {
    error(to, describe(error));
  }

  /** The fixed wording for a refusal. */
  static String describe(GameError error) {
    return switch (error) {
      case ALREADY_JOINED -> "You are already in that arena.";
      case IN_PROGRESS -> "A game is under way there. Use /arena spec to watch.";
      case FULL -> "That arena is full.";
      case NOT_A_MEMBER -> "You are not in that arena.";
      case NOT_IN_LOBBY -> "You can only do that in the lobby.";
      case UNKNOWN_CLASS -> "There is no such class.";
      case CLASS_LOCKED -> "You have not unlocked that class yet.";
      case NO_CLASS -> "Pick a class first.";
      case NOTHING_TO_START -> "There is nobody with a class to start a game with.";
    };
  }
}
