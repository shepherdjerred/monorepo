package com.shepherdjerred.thestorm.discord.adapter.paper;

import com.shepherdjerred.thestorm.chat.app.MessagingPolicy;
import com.shepherdjerred.thestorm.core.expansion.ManagedGameplay;
import com.shepherdjerred.thestorm.core.players.KnownPlayer;
import com.shepherdjerred.thestorm.core.players.PlayerDirectory;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.discord.app.DiscordCommand;
import com.shepherdjerred.thestorm.discord.app.DiscordRelay;
import com.shepherdjerred.thestorm.mail.app.Letters;
import java.time.Duration;
import java.time.InstantSource;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executor;
import java.util.function.Consumer;
import java.util.random.RandomGenerator;
import net.kyori.adventure.text.Component;
import org.bukkit.Server;
import org.slf4j.Logger;

/**
 * {@code /mail <player> <text>} from Discord: a letter from the sender's linked player, under the
 * same gates, filters and limits as {@code /mail send} in game. The sender may be offline, so they
 * never count as staff or as bypassing the filters.
 */
public final class DiscordMail {

  /** How long one Discord user waits between letters, on top of the letter limits. */
  static final Duration COOLDOWN = Duration.ofSeconds(30);

  /**
   * What sending needs.
   *
   * @param letters the mail module's letters
   * @param limits letter length, interval and inbox limits
   * @param gameplay the managed rollout gates
   * @param policy the messaging filters
   * @param players name lookups
   */
  public record Ports(
      Letters letters,
      Letters.Limits limits,
      ManagedGameplay gameplay,
      MessagingPolicy policy,
      PlayerDirectory players) {}

  /**
   * The server side.
   *
   * @param server for telling an online recipient
   * @param mainThread runs policy checks and replies
   * @param time when letters are sent
   * @param random letter ids
   * @param logger failures
   */
  public record Side(
      Server server,
      Executor mainThread,
      InstantSource time,
      RandomGenerator random,
      Logger logger) {}

  private final Ports ports;
  private final Side runtime;

  public DiscordMail(Ports ports, Side runtime) {
    this.ports = ports;
    this.runtime = runtime;
  }

  public DiscordCommand command() {
    return new DiscordCommand(
        "mail",
        "Send an in-game letter from your linked player",
        List.of(
            new DiscordCommand.Option("player", "Who to write to", true),
            new DiscordCommand.Option("text", "The letter", true)),
        COOLDOWN,
        this::answer);
  }

  private void answer(DiscordCommand.Request request, Consumer<String> reply) {
    var sender = request.player();
    var to = request.options().get("player");
    var text = request.options().get("text");
    if (sender.isEmpty()) {
      reply.accept("Link your account first: use /link here.");
      return;
    }
    if (to == null || text == null || text.isBlank()) {
      reply.accept("Name a player and write a letter.");
      return;
    }
    var _ =
        send(sender.orElseThrow(), to.strip(), text.strip())
            .whenComplete(
                (answer, failure) -> {
                  if (failure != null) {
                    runtime.logger().error("Sending a letter from Discord failed", failure);
                    reply.accept("That did not work; try again in a moment.");
                  } else {
                    reply.accept(answer);
                  }
                });
  }

  private CompletableFuture<String> send(UUID sender, String to, String text) {
    var gameplay = ports.gameplay();
    return gameplay
        .enabled(ManagedGameplay.LETTERS, sender)
        .thenCompose(
            allowed ->
                !allowed
                    ? done("Letters are not enabled for you.")
                    : ports
                        .players()
                        .byName(to)
                        .thenCompose(
                            recipient ->
                                recipient.isEmpty()
                                    ? done(DiscordRelay.escape(to) + " has never played here.")
                                    : toRecipient(sender, recipient.orElseThrow(), text)));
  }

  private CompletableFuture<String> toRecipient(UUID sender, KnownPlayer recipient, String text) {
    var gameplay = ports.gameplay();
    return gameplay
        .enabled(ManagedGameplay.LETTERS, recipient.uuid())
        .thenCompose(
            allowed ->
                !allowed
                    ? done("Letters are not available for that player.")
                    : gameplay
                        .enabled(ManagedGameplay.IDENTITY, recipient.uuid())
                        .thenCombine(ports.players().byId(sender), Checked::new)
                        .thenComposeAsync(
                            checked -> write(sender, checked, recipient, text),
                            runtime.mainThread()));
  }

  private record Checked(boolean identity, Optional<KnownPlayer> sender) {}

  /** Main thread: filters the letter as the game would, then sends it. */
  private CompletableFuture<String> write(
      UUID sender, Checked checked, KnownPlayer recipient, String text) {
    var name = checked.sender().map(KnownPlayer::lastName).orElseThrow();
    var policy =
        ports
            .policy()
            .letter(
                new MessagingPolicy.Attempt(
                    sender,
                    name,
                    false,
                    false,
                    recipient.uuid(),
                    text,
                    new MessagingPolicy.LetterPolicy(
                        ports.limits().maxLength(), checked.identity())));
    return switch (policy) {
      case Result.Err<String, String>(var error) -> done(DiscordRelay.escape(error));
      case Result.Ok<String, String>(var accepted) -> {
        var random = runtime.random();
        var letter =
            new Letters.Letter(
                new UUID(
                    (random.nextLong() & 0xffffffffffff0fffL) | 0x4000L,
                    (random.nextLong() & 0x3fffffffffffffffL) | 0x8000000000000000L),
                sender,
                name,
                recipient.uuid(),
                accepted,
                runtime.time().instant(),
                false);
        yield ports
            .letters()
            .send(letter, ports.limits())
            .thenApplyAsync(result -> delivered(letter, recipient, result), runtime.mainThread());
      }
    };
  }

  private String delivered(
      Letters.Letter letter, KnownPlayer recipient, Result<UUID, String> result) {
    return switch (result) {
      case Result.Err<UUID, String>(var error) -> DiscordRelay.escape(error);
      case Result.Ok<UUID, String> _ -> {
        ports.policy().delivered(letter.sender(), letter.text());
        var online = runtime.server().getPlayer(recipient.uuid());
        if (online != null) {
          online.sendMessage(
              Component.text("A letter from " + letter.senderName() + " arrived. /mail"));
        }
        yield "Letter sent to " + DiscordRelay.escape(recipient.lastName()) + ".";
      }
    };
  }

  private static CompletableFuture<String> done(String text) {
    return CompletableFuture.completedFuture(text);
  }
}
