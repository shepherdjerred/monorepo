package com.shepherdjerred.thestorm.safety.adapter.paper;

import com.mojang.brigadier.arguments.StringArgumentType;
import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.safety.ContentSubmission;
import com.shepherdjerred.thestorm.safety.app.EvidenceStore;
import io.papermc.paper.command.brigadier.Commands;
import java.util.UUID;
import net.kyori.adventure.text.Component;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;

/**
 * Explicit staff-only evidence access, including private messages. Every query is itself audited.
 */
public final class EvidenceCommands {
  private final ModuleContext context;
  private final EvidenceStore store;

  public EvidenceCommands(ModuleContext context, EvidenceStore store) {
    this.context = context;
    this.store = store;
  }

  public void register(Commands registrar) {
    registrar.register(
        Commands.literal("safety")
            .requires(source -> source.getSender().hasPermission("thestorm.safety.evidence"))
            .then(
                Commands.literal("search")
                    .then(
                        Commands.argument("player", StringArgumentType.word())
                            .executes(
                                command ->
                                    search(
                                        command.getSource().getSender(),
                                        StringArgumentType.getString(command, "player"),
                                        ""))
                            .then(
                                Commands.argument("text", StringArgumentType.greedyString())
                                    .executes(
                                        command ->
                                            search(
                                                command.getSource().getSender(),
                                                StringArgumentType.getString(command, "player"),
                                                StringArgumentType.getString(command, "text"))))))
            .build(),
        "Search the permanent private evidence archive");
  }

  private int search(CommandSender sender, String player, String text) {
    var actor = sender instanceof Player human ? human.getUniqueId() : new UUID(0, 0);
    var id = new UUID(context.random().nextLong(), context.random().nextLong());
    var query =
        new ContentSubmission(
            id,
            actor,
            sender.getName(),
            "evidence-access",
            "staff",
            com.shepherdjerred.thestorm.safety.domain.ContentRules.redact(player + " " + text),
            "",
            "");
    var _ =
        store
            .attempt(query, context.time().instant())
            .thenCompose(
                done ->
                    store.search(
                        player.equals("*") ? "" : player,
                        com.shepherdjerred.thestorm.safety.domain.ContentRules.redact(text),
                        20))
            .thenCompose(
                result ->
                    store
                        .event(id, "evidence-viewed", "", context.time().instant())
                        .thenApply(done -> result))
            .whenCompleteAsync(
                (result, failure) -> {
                  if (failure != null) {
                    context.logger().error("Evidence query failed: {}", id, failure);
                    sender.sendMessage(Component.text("Evidence query failed. Reference " + id));
                  } else if (sender instanceof Player) sender.sendMessage(Component.text(result));
                  else
                    sender.sendMessage(
                        Component.text(
                            "Private evidence is available through toolkit mc evidence; console output is intentionally limited. Reference "
                                + id));
                },
                context.scheduler().mainThread());
    return 1;
  }
}
