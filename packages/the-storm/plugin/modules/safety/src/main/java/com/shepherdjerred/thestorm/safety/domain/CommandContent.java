package com.shepherdjerred.thestorm.safety.domain;

import java.util.Locale;
import java.util.Set;

/** Separates authored prose from recipient names and command identifiers. */
public record CommandContent(String surface, String text, boolean screen, boolean secret) {
  private static final Set<String> PRIVATE = Set.of("msg", "tell", "whisper", "w");
  private static final Set<String> CHAT =
      Set.of(
          "g", "global", "war", "wc", "sc", "tc", "t", "teammsg", "tm", "say", "dead", "me", "r");
  private static final Set<String> SECRET =
      Set.of("login", "register", "changepassword", "password", "auth", "discordlink", "link");
  private static final Set<String> PROSE =
      Set.of("nick", "nickname", "sethome", "setwarp", "renamehome", "renamewarp");
  private static final Set<String> IDENTIFIERS =
      Set.of(
          "tp",
          "teleport",
          "tpa",
          "tpahere",
          "tpaccept",
          "tpdeny",
          "arena",
          "rwf",
          "survival",
          "rtp",
          "kit",
          "kits",
          "suicide",
          "unmute",
          "unban",
          "op",
          "deop",
          "gamemode",
          "gm",
          "fly",
          "speed",
          "home",
          "warp",
          "spawn",
          "clear",
          "heal",
          "feed",
          "time",
          "weather",
          "difficulty",
          "kill",
          "experience",
          "xp",
          "agent",
          "escalations",
          "channels",
          "ignore",
          "unignore",
          "baltop",
          "balance",
          "pay");

  public static CommandContent parse(String raw) {
    var pieces = raw.strip().split("\\s+", 2);
    var label =
        pieces[0].replaceFirst("^/", "").toLowerCase(Locale.ROOT).replaceFirst("^[^:]+:", "");
    var arguments = pieces.length == 2 ? pieces[1] : "";
    if (SECRET.contains(label)
        || (label.equals("discord") && arguments.toLowerCase(Locale.ROOT).startsWith("link")))
      return new CommandContent("command", "/" + label + " [redacted]", false, true);
    if (PRIVATE.contains(label)) return addressed(arguments);
    if (CHAT.contains(label))
      return new CommandContent("chat", arguments, !arguments.isBlank(), false);
    if (label.equals("mail") || label.equals("letter")) return mail(arguments);
    if (label.equals("town")) return town(arguments);
    if (label.equals("ticket") || label.equals("tickets") || label.equals("safety")) {
      return ticket(label, arguments);
    }
    if (IDENTIFIERS.contains(label) || arguments.isBlank())
      return new CommandContent("command", arguments, false, false);
    return new CommandContent(
        PROSE.contains(label) ? label : "command-content", arguments, true, false);
  }

  private static CommandContent addressed(String arguments) {
    var parts = arguments.split("\\s+", 2);
    return new CommandContent(
        "message", parts.length == 2 ? parts[1] : "", parts.length == 2, false);
  }

  private static CommandContent ticket(String label, String arguments) {
    var operation = arguments.split("\\s+", 2)[0].toLowerCase(Locale.ROOT);
    return new CommandContent(
        "ticket",
        arguments,
        !arguments.isBlank()
            && !label.equals("safety")
            && !Set.of("view", "claim", "escalate", "reopen", "list").contains(operation),
        false);
  }

  private static CommandContent mail(String arguments) {
    var parts = arguments.split("\\s+", 3);
    if (parts.length == 3 && Set.of("send", "reply").contains(parts[0].toLowerCase(Locale.ROOT)))
      return new CommandContent("letter", parts[2], true, false);
    return new CommandContent("command", arguments, false, false);
  }

  private static CommandContent town(String arguments) {
    var parts = arguments.split("\\s+", 2);
    if (parts.length == 2 && Set.of("create", "rename").contains(parts[0].toLowerCase(Locale.ROOT)))
      return new CommandContent("town-name", parts[1], true, false);
    return new CommandContent("command", arguments, false, false);
  }
}
