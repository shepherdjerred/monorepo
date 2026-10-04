package com.shepherdjerred.thestorm.mail.adapter.paper;

import static com.mojang.brigadier.arguments.StringArgumentType.getString;
import static com.mojang.brigadier.arguments.StringArgumentType.word;

import com.mojang.brigadier.Command;
import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.mail.app.Mail;
import io.papermc.paper.command.brigadier.Commands;
import java.util.HashSet;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import net.kyori.adventure.text.Component;
import org.bukkit.NamespacedKey;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.inventory.ItemStack;
import org.bukkit.persistence.PersistentDataType;

/** Grants items and saves the delivery receipt in the same player-data save. */
public final class MailCommands implements Listener {
  private static final NamespacedKey RECEIPT =
      new NamespacedKey("thestorm", "mail_delivery_receipt");
  private final ModuleContext context;
  private final Mail mail;
  private final Set<UUID> busy = new HashSet<>();

  public MailCommands(ModuleContext context, Mail mail) {
    this.context = context;
    this.mail = mail;
  }

  public void register(Commands commands) {
    commands.register(
        Commands.literal("mail")
            .requires(source -> source.getSender() instanceof Player)
            .executes(command -> list((Player) command.getSource().getSender()))
            .then(
                Commands.literal("claim")
                    .then(
                        Commands.argument("id", word())
                            .then(
                                Commands.argument("option", word())
                                    .executes(
                                        command ->
                                            claim(
                                                (Player) command.getSource().getSender(),
                                                getString(command, "id"),
                                                getString(command, "option"))))))
            .build(),
        "Read and collect your non-expiring mail");
  }

  private int list(Player player) {
    var _ =
        mail.list(player.getUniqueId())
            .whenCompleteAsync(
                (messages, failure) -> {
                  if (failure != null) {
                    failed(player, failure);
                    return;
                  }
                  if (messages.isEmpty()) {
                    player.sendMessage(Component.text("Your mailbox is empty."));
                  }
                  for (var message : messages) {
                    player.sendMessage(Component.text(message.title() + " — " + message.id()));
                    var options =
                        message.selected().isEmpty()
                            ? String.join("|", message.options())
                            : message.selected();
                    player.sendMessage(
                        Component.text(
                            "/mail claim "
                                + message.id()
                                + " "
                                + options
                                + (message.selected().isEmpty()
                                    ? " (choose one)"
                                    : " (" + message.remaining() + " stacks left)")));
                  }
                },
                context.scheduler().mainThread());
    return Command.SINGLE_SUCCESS;
  }

  private int claim(Player player, String id, String option) {
    UUID message;
    try {
      message = UUID.fromString(id);
    } catch (IllegalArgumentException e) {
      player.sendMessage(Component.text("Use the message id shown by /mail."));
      return Command.SINGLE_SUCCESS;
    }
    if (!busy.add(player.getUniqueId())) {
      player.sendMessage(Component.text("Your delivery is still settling."));
      return Command.SINGLE_SUCCESS;
    }
    if (receipt(player).isPresent()) {
      var _ =
          mail.selection(message, player.getUniqueId())
              .thenAcceptAsync(
                  selected -> {
                    var response =
                        selected
                            .filter(value -> !value.equals(option))
                            .map(
                                value ->
                                    "You already chose "
                                        + value
                                        + ". The other option is no longer available.")
                            .orElse(
                                "Reconnect before collecting more mail so your last delivery can be saved safely.");
                    player.sendMessage(Component.text(response));
                  },
                  context.scheduler().mainThread())
              .whenCompleteAsync(
                  (ignored, failure) -> {
                    busy.remove(player.getUniqueId());
                    if (failure != null) {
                      failed(player, failure);
                    }
                  },
                  context.scheduler().mainThread());
      return Command.SINGLE_SUCCESS;
    }
    var _ =
        CompletableFuture.<Void>completedFuture(null)
            .thenComposeAsync(
                ignored -> {
                  if (!player.isOnline()) {
                    return CompletableFuture.completedFuture(
                        Result.<Mail.Batch, String>err("You left before delivery."));
                  }
                  var token = new UUID(context.random().nextLong(), context.random().nextLong());
                  return mail.reserve(
                      new Mail.Claim(
                          message, player.getUniqueId(), option, capacity(player), token));
                },
                context.scheduler().mainThread())
            .thenComposeAsync(
                result -> {
                  return switch (result) {
                    case Result.Err<Mail.Batch, String>(var reason) -> {
                      player.sendMessage(Component.text(reason));
                      yield CompletableFuture.completedFuture(null);
                    }
                    case Result.Ok<Mail.Batch, String>(var batch) -> deliver(player, batch);
                  };
                },
                context.scheduler().mainThread())
            .whenCompleteAsync(
                (ignored, failure) -> {
                  busy.remove(player.getUniqueId());
                  if (failure != null) {
                    failed(player, failure);
                  }
                },
                context.scheduler().mainThread());
    return Command.SINGLE_SUCCESS;
  }

  private CompletableFuture<Void> deliver(Player player, Mail.Batch batch) {
    if (!player.isOnline() || capacity(player) < batch.items().size()) {
      player.sendMessage(Component.text("Make room and collect this delivery again with /mail."));
      return CompletableFuture.completedFuture(null);
    }
    var stacks =
        batch.items().stream().map(item -> ItemStack.deserializeBytes(item.bytes())).toList();
    if (stacks.stream()
        .anyMatch(stack -> stack.isEmpty() || stack.getAmount() > stack.getMaxStackSize())) {
      throw new IllegalStateException("mail contains an invalid item stack");
    }
    for (var stack : stacks) {
      var slot = player.getInventory().firstEmpty();
      if (slot < 0 || slot >= 36) {
        throw new IllegalStateException("inventory capacity changed during mail handoff");
      }
      player.getInventory().setItem(slot, stack);
    }
    player
        .getPersistentDataContainer()
        .set(RECEIPT, PersistentDataType.STRING, batch.token().toString());
    // Persist the receipt with the delivered inventory before players can move the items out of
    // player data. If a crash interrupts the later mailbox acknowledgement, the receipt makes it
    // idempotent on reconnect.
    player.saveData();
    player.sendMessage(
        Component.text(
            "Collected "
                + batch.items().size()
                + " stacks. Reconnect before collecting more mail to finish saving this delivery."));
    return CompletableFuture.completedFuture(null);
  }

  @EventHandler
  public void onJoin(PlayerJoinEvent event) {
    var player = event.getPlayer();
    if (!busy.add(player.getUniqueId())) {
      return;
    }
    var _ =
        recover(player)
            .whenCompleteAsync(
                (ignored, failure) -> {
                  busy.remove(player.getUniqueId());
                  if (failure != null) {
                    failed(player, failure);
                  }
                },
                context.scheduler().mainThread());
  }

  private CompletableFuture<Void> recover(Player player) {
    var receipt = receipt(player);
    if (receipt.isEmpty()) {
      return CompletableFuture.completedFuture(null);
    }
    return mail.acknowledge(player.getUniqueId(), UUID.fromString(receipt.get()))
        .thenRunAsync(
            () -> player.getPersistentDataContainer().remove(RECEIPT),
            context.scheduler().mainThread());
  }

  private static Optional<String> receipt(Player player) {
    return Optional.ofNullable(
        player.getPersistentDataContainer().get(RECEIPT, PersistentDataType.STRING));
  }

  private static int capacity(Player player) {
    var free = 0;
    for (var slot = 0; slot < 36; slot++) {
      var item = player.getInventory().getItem(slot);
      if (item == null || item.isEmpty()) {
        free++;
      }
    }
    return Math.min(free, 16);
  }

  private void failed(Player player, Throwable failure) {
    context
        .logger()
        .error("Mail delivery for {} needs reconciliation", player.getUniqueId(), failure);
    player.sendMessage(Component.text("Your mail is saved. Delivery needs staff reconciliation."));
  }
}
