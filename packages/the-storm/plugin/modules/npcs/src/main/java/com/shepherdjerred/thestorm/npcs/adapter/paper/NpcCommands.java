package com.shepherdjerred.thestorm.npcs.adapter.paper;

import static com.mojang.brigadier.arguments.StringArgumentType.getString;
import static com.mojang.brigadier.arguments.StringArgumentType.word;

import com.mojang.brigadier.Command;
import com.mojang.brigadier.builder.RequiredArgumentBuilder;
import com.mojang.brigadier.tree.LiteralCommandNode;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.core.text.HouseStyle;
import com.shepherdjerred.thestorm.npcs.app.ActionRegistry;
import com.shepherdjerred.thestorm.npcs.app.ContentSource;
import com.shepherdjerred.thestorm.npcs.app.NpcCatalog;
import com.shepherdjerred.thestorm.npcs.domain.content.Content;
import com.shepherdjerred.thestorm.npcs.domain.content.ContentProblem;
import com.shepherdjerred.thestorm.npcs.domain.content.Ids;
import com.shepherdjerred.thestorm.npcs.domain.content.Snippets;
import com.shepherdjerred.thestorm.npcs.domain.geo.Spot;
import io.papermc.paper.command.brigadier.CommandSourceStack;
import io.papermc.paper.command.brigadier.Commands;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executor;
import java.util.function.Supplier;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.event.ClickEvent;
import net.kyori.adventure.text.event.HoverEvent;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.logger.slf4j.ComponentLogger;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.bukkit.event.player.PlayerTeleportEvent;

/**
 * {@code /npc}, for administrators ({@value #PERMISSION}): {@code list}, {@code tp <id>}, {@code
 * reload} and {@code here <id>}. NPCs are content in the repository, so nothing here edits them;
 * {@code here} prints a snippet to paste into a content file instead.
 */
final class NpcCommands {

  static final String PERMISSION = "thestorm.npcs.admin";
  static final String LABEL = "NPCs";
  private static final String ID = "id";

  /**
   * What the commands drive.
   *
   * @param source reads the content files; runs off the main thread
   * @param reader where {@code source} runs
   */
  record Wiring(
      NpcCatalog catalog,
      NpcWorld world,
      ActionRegistry actions,
      Supplier<ContentSource> source,
      Executor reader,
      Executor mainThread,
      ComponentLogger logger) {}

  private final Wiring wiring;

  NpcCommands(Wiring wiring) {
    this.wiring = wiring;
  }

  void register(Commands commands) {
    commands.register(node(), "Lists, finds and reloads NPCs");
  }

  LiteralCommandNode<CommandSourceStack> node() {
    return Commands.literal("npc")
        .requires(source -> source.getSender().hasPermission(PERMISSION))
        .then(Commands.literal("list").executes(context -> list(context.getSource().getSender())))
        .then(
            Commands.literal("tp")
                .then(
                    npcArgument()
                        .executes(
                            context ->
                                tp(context.getSource().getSender(), getString(context, ID)))))
        .then(
            Commands.literal("reload").executes(context -> reload(context.getSource().getSender())))
        .then(
            Commands.literal("here")
                .then(
                    Commands.argument(ID, word())
                        .executes(
                            context ->
                                here(context.getSource().getSender(), getString(context, ID)))))
        .build();
  }

  private RequiredArgumentBuilder<CommandSourceStack, String> npcArgument() {
    return Commands.argument(ID, word())
        .suggests(
            (context, builder) -> {
              var prefix = builder.getRemainingLowerCase();
              wiring.catalog().content().npcs().keySet().stream()
                  .filter(id -> id.startsWith(prefix))
                  .sorted()
                  .forEach(builder::suggest);
              return builder.buildFuture();
            });
  }

  private int list(CommandSender sender) {
    var npcs = wiring.catalog().content().sortedNpcs();
    sender.sendMessage(info(npcs.size() + " NPCs:"));
    for (var npc : npcs) {
      var home = npc.home().position();
      var state =
          wiring
              .world()
              .entity(npc.id())
              .map(entity -> entity.isValid() ? "here" : "unloaded")
              .orElse("missing");
      sender.sendMessage(
          Component.text(
              String.format(
                  Locale.ROOT,
                  " %s: %s (%s %.0f %.0f %.0f) %s%s",
                  npc.id(),
                  npc.name(),
                  npc.home().world(),
                  home.x(),
                  home.y(),
                  home.z(),
                  state,
                  npc.roles().isEmpty() ? "" : " " + npc.roles().stream().sorted().toList()),
              NamedTextColor.GRAY));
    }
    return Command.SINGLE_SUCCESS;
  }

  private int tp(CommandSender sender, String id) {
    if (!(sender instanceof Player player)) {
      sender.sendMessage(error("Only players can teleport."));
      return Command.SINGLE_SUCCESS;
    }
    var npc = wiring.catalog().content().npc(id);
    if (npc.isEmpty()) {
      sender.sendMessage(error("There is no NPC " + id + "."));
      return Command.SINGLE_SUCCESS;
    }
    var destination =
        wiring.world().location(id).orElseGet(() -> wiring.world().homeLocation(npc.get()));
    var _ = player.teleportAsync(destination, PlayerTeleportEvent.TeleportCause.COMMAND);
    sender.sendMessage(info("Teleporting to " + npc.get().name() + "."));
    return Command.SINGLE_SUCCESS;
  }

  private int reload(CommandSender sender) {
    sender.sendMessage(info("Reloading NPC content..."));
    var source = wiring.source().get();
    var _ =
        CompletableFuture.supplyAsync(source::load, wiring.reader())
            .whenCompleteAsync(
                (result, failure) -> {
                  if (failure != null) {
                    wiring.logger().error("NPC reload failed", failure);
                    sender.sendMessage(error("Reload failed; see the server log."));
                    return;
                  }
                  applyReload(sender, result);
                },
                wiring.mainThread());
    return Command.SINGLE_SUCCESS;
  }

  private void applyReload(CommandSender sender, Result<Content, List<ContentProblem>> result) {
    switch (result) {
      case Result.Ok<Content, List<ContentProblem>>(var content) -> {
        wiring.catalog().replace(content);
        var report = wiring.world().reconcile();
        sender.sendMessage(success("Reloaded " + content.npcs().size() + " NPCs: " + report + "."));
        var missing = wiring.actions().missing(content.dialogues().values());
        if (!missing.isEmpty()) {
          sender.sendMessage(error("Dialogue actions nobody registered: " + missing));
        }
      }
      case Result.Err<Content, List<ContentProblem>>(var problems) -> {
        sender.sendMessage(
            error("Content has " + problems.size() + " problems; kept the old NPCs:"));
        problems.forEach(
            problem -> sender.sendMessage(Component.text(" " + problem, NamedTextColor.RED)));
      }
    }
  }

  private int here(CommandSender sender, String id) {
    if (!(sender instanceof Player player)) {
      sender.sendMessage(error("Only players have a location."));
      return Command.SINGLE_SUCCESS;
    }
    if (!Ids.valid(id)) {
      sender.sendMessage(error(Ids.RULE + "."));
      return Command.SINGLE_SUCCESS;
    }
    var feet = NpcWorld.feetOf(player);
    var spot =
        new Spot(
            player.getWorld().getKey().asString(),
            Mannequins.position(feet),
            Mannequins.facing(feet));
    var snippet = Snippets.home(id, spot);
    sender.sendMessage(info("Paste into a file under plugins/TheStorm/npcs/ (click to copy):"));
    sender.sendMessage(
        Component.text(snippet, NamedTextColor.WHITE)
            .clickEvent(ClickEvent.copyToClipboard(snippet))
            .hoverEvent(HoverEvent.showText(Component.text("Copy"))));
    return Command.SINGLE_SUCCESS;
  }

  private static Component info(String message) {
    return HouseStyle.info(LABEL, Component.text(message));
  }

  private static Component success(String message) {
    return HouseStyle.success(LABEL, Component.text(message));
  }

  private static Component error(String message) {
    return HouseStyle.error(LABEL, Component.text(message));
  }
}
