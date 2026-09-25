package com.shepherdjerred.thestorm.chat.adapter.paper;

import com.shepherdjerred.thestorm.chat.domain.ChannelAccess;
import com.shepherdjerred.thestorm.chat.domain.ChannelKey;
import com.shepherdjerred.thestorm.chat.domain.ChatDenial;
import com.shepherdjerred.thestorm.chat.domain.Durations;
import com.shepherdjerred.thestorm.chat.domain.ProfileError;
import com.shepherdjerred.thestorm.core.text.HouseStyle;
import java.util.List;
import java.util.Locale;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.JoinConfiguration;

/** The chat module's replies, in the house style. */
final class Feedback {

  static final String LABEL = "Chat";

  private Feedback() {}

  static Component info(String message) {
    return HouseStyle.info(LABEL, Component.text(message));
  }

  static Component success(String message) {
    return HouseStyle.success(LABEL, Component.text(message));
  }

  static Component error(String message) {
    return HouseStyle.error(LABEL, Component.text(message));
  }

  static Component denials(List<ChatDenial> denials) {
    return Component.join(
        JoinConfiguration.newlines(),
        denials.stream().map(denial -> error(describe(denial))).toList());
  }

  static String describe(ChatDenial denial) {
    return switch (denial) {
      case ChatDenial.Blank() -> "Say something first.";
      case ChatDenial.TooLong(var max) -> "That message is longer than " + max + " characters.";
      case ChatDenial.TooManyCaps(var max) ->
          "Easy on the caps: at most " + max + " words in capitals.";
      case ChatDenial.Repeated(var retryAfter) ->
          "You just said that. Wait " + Durations.format(retryAfter) + " to say it again.";
      case ChatDenial.Muted(var remaining, var reason) ->
          "You are muted for " + Durations.format(remaining) + ": " + reason;
      case ChatDenial.NoAccess(var channel, var access) -> describe(channel, access);
    };
  }

  static String describe(ChannelKey channel, ChannelAccess access) {
    var group = channel.displayName().toLowerCase(Locale.ROOT);
    return switch (access) {
      case GRANTED -> "You can talk in " + channel.displayName() + " chat.";
      case NO_PERMISSION -> "You cannot use " + channel.displayName() + " chat.";
      case UNAVAILABLE -> "Towns are not available yet, so there is no " + group + " chat.";
      case NOT_A_MEMBER -> "You are not in a " + group + ".";
    };
  }

  static String describe(ProfileError error) {
    return switch (error) {
      case CANNOT_HIDE_FOCUSED -> "You talk in that channel. Switch to another one first.";
      case ALREADY_HIDDEN -> "That channel is already hidden.";
      case NOT_HIDDEN -> "That channel is not hidden.";
      case CANNOT_IGNORE_SELF -> "You cannot ignore yourself.";
      case CANNOT_IGNORE_STAFF -> "Staff cannot be ignored.";
      case ALREADY_IGNORED -> "You already ignore that player.";
      case NOT_IGNORED -> "You do not ignore that player.";
    };
  }
}
