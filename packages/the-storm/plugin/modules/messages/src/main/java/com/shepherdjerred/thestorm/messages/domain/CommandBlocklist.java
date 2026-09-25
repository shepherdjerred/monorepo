package com.shepherdjerred.thestorm.messages.domain;

import java.util.Locale;
import java.util.Set;

/**
 * Commands that reveal the server's plugins or version to players. A namespaced form such as {@code
 * /bukkit:plugins} is blocked with its plain label.
 *
 * @param labels blocked command labels: lowercase, without a slash, namespace or spaces
 */
public record CommandBlocklist(Set<String> labels) {

  public CommandBlocklist {
    labels = Set.copyOf(labels);
    for (var label : labels) {
      if (label.isEmpty()
          || !label.equals(label.toLowerCase(Locale.ROOT))
          || label.startsWith("/")
          || label.contains(":")
          || label.chars().anyMatch(Character::isWhitespace)) {
        throw new IllegalArgumentException(
            "blocked command must be a bare lowercase label such as 'plugins': '" + label + "'");
      }
    }
  }

  /**
   * Whether {@code label} (as typed or as listed to the client, possibly namespaced like {@code
   * bukkit:pl}) is blocked.
   */
  public boolean blocks(String label) {
    var lower = label.toLowerCase(Locale.ROOT);
    var colon = lower.indexOf(':');
    return labels.contains(colon < 0 ? lower : lower.substring(colon + 1));
  }

  /** Whether the chat line {@code message}, such as {@code "/pl"}, runs a blocked command. */
  public boolean blocksMessage(String message) {
    var line = message.startsWith("/") ? message.substring(1) : message;
    var trimmed = line.strip();
    var space = indexOfWhitespace(trimmed);
    return blocks(space < 0 ? trimmed : trimmed.substring(0, space));
  }

  private static int indexOfWhitespace(String text) {
    for (var i = 0; i < text.length(); i++) {
      if (Character.isWhitespace(text.charAt(i))) {
        return i;
      }
    }
    return -1;
  }
}
