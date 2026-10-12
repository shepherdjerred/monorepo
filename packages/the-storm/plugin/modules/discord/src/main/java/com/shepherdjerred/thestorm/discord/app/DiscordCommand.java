package com.shepherdjerred.thestorm.discord.app;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Consumer;
import java.util.regex.Pattern;

/**
 * A read-only slash command another module adds to the bridge with {@link DiscordRelay#addCommand}.
 * It answers privately, and only in the bridged channel.
 *
 * @param name the command, such as {@code arena-top}
 * @param description what Discord shows under it
 * @param options its string options
 * @param cooldown how long one Discord user waits between uses; zero for read-only commands
 * @param handler answers it
 */
public record DiscordCommand(
    String name, String description, List<Option> options, Duration cooldown, Handler handler) {

  private static final Pattern NAME = Pattern.compile("[a-z][a-z0-9-]{0,31}");

  public DiscordCommand {
    options = List.copyOf(options);
    if (cooldown.isNegative()) {
      throw new IllegalArgumentException("a cooldown cannot be negative: " + cooldown);
    }
    requireName(name);
    requireDescription(description);
  }

  private static void requireName(String name) {
    if (!NAME.matcher(name).matches()) {
      throw new IllegalArgumentException("not a slash command name: " + name);
    }
  }

  private static void requireDescription(String description) {
    if (description.isBlank() || description.length() > 100) {
      throw new IllegalArgumentException("a description is 1..100 characters: " + description);
    }
  }

  /**
   * A string option.
   *
   * @param name the option
   * @param description what Discord shows for it
   * @param required whether it must be given
   */
  public record Option(String name, String description, boolean required) {

    public Option {
      requireName(name);
      requireDescription(description);
    }
  }

  /**
   * One use of a command.
   *
   * @param options the options given, by name
   * @param discordUser who used it
   * @param player the Minecraft player their Discord account is linked to, if any
   */
  public record Request(Map<String, String> options, long discordUser, Optional<UUID> player) {

    public Request {
      options = Map.copyOf(options);
    }
  }

  /** Answers a command. */
  @FunctionalInterface
  public interface Handler {

    /**
     * Called on a JDA thread: hop to the main thread before touching the game, and never block.
     *
     * @param request what was asked, and by whom
     * @param reply takes the answer (Discord markdown; escape player text with {@link
     *     DiscordRelay#escape}); safe to call from any thread, once
     */
    void answer(Request request, Consumer<String> reply);
  }
}
