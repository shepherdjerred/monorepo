package com.shepherdjerred.thestorm.towns.adapter.paper;

import static com.mojang.brigadier.arguments.StringArgumentType.getString;
import static com.mojang.brigadier.arguments.StringArgumentType.word;
import static java.util.stream.Collectors.joining;

import com.mojang.brigadier.Command;
import com.mojang.brigadier.tree.LiteralCommandNode;
import com.shepherdjerred.thestorm.towns.domain.region.AdminRegion;
import com.shepherdjerred.thestorm.towns.domain.region.RegionAllowance;
import com.shepherdjerred.thestorm.towns.domain.region.RegionIndex;
import io.papermc.paper.command.brigadier.CommandSourceStack;
import io.papermc.paper.command.brigadier.Commands;
import java.util.Locale;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;

/**
 * {@code /region list} and {@code /region info [id]} for staff. Regions are defined in {@code
 * towns.yml}, which the repository owns; these commands only read them.
 */
final class RegionCommands {

  static final String ADMIN_PERMISSION = "thestorm.towns.admin";

  private static final String ID = "id";

  private final RegionIndex regions;

  RegionCommands(RegionIndex regions) {
    this.regions = regions;
  }

  void register(Commands commands) {
    commands.register(region(), "Lists and describes admin regions");
  }

  private LiteralCommandNode<CommandSourceStack> region() {
    return Commands.literal("region")
        .requires(source -> source.getSender().hasPermission(ADMIN_PERMISSION))
        .then(Commands.literal("list").executes(context -> list(context.getSource().getSender())))
        .then(
            Commands.literal("info")
                .executes(context -> here(context.getSource().getSender()))
                .then(
                    Commands.argument(ID, word())
                        .suggests(
                            (context, builder) -> {
                              regions.all().stream()
                                  .map(AdminRegion::id)
                                  .filter(id -> id.startsWith(builder.getRemainingLowerCase()))
                                  .forEach(builder::suggest);
                              return builder.buildFuture();
                            })
                        .executes(
                            context ->
                                byId(context.getSource().getSender(), getString(context, ID)))))
        .build();
  }

  private int list(CommandSender sender) {
    if (regions.all().isEmpty()) {
      sender.sendMessage(Notices.info("No admin regions are defined."));
      return Command.SINGLE_SUCCESS;
    }
    sender.sendMessage(Notices.info("Admin regions, first listed wins where they overlap:"));
    for (var region : regions.all()) {
      sender.sendMessage(Notices.info(region.id() + " (" + region.name() + ")"));
    }
    return Command.SINGLE_SUCCESS;
  }

  private int here(CommandSender sender) {
    if (!(sender instanceof Player player)) {
      sender.sendMessage(Notices.error("Name a region: /region info <id>"));
      return Command.SINGLE_SUCCESS;
    }
    var location = Guard.position(player);
    regions
        .at(
            Guard.world(location).getName(),
            location.getBlockX(),
            location.getBlockY(),
            location.getBlockZ())
        .ifPresentOrElse(
            region -> describe(sender, region),
            () -> sender.sendMessage(Notices.info("You are not in an admin region.")));
    return Command.SINGLE_SUCCESS;
  }

  private int byId(CommandSender sender, String id) {
    regions
        .byId(id.toLowerCase(Locale.ROOT))
        .ifPresentOrElse(
            region -> describe(sender, region),
            () -> sender.sendMessage(Notices.error("No admin region has the id " + id + ".")));
    return Command.SINGLE_SUCCESS;
  }

  private static void describe(CommandSender sender, AdminRegion region) {
    sender.sendMessage(Notices.info(region.name() + " (" + region.id() + ")"));
    for (var area : region.areas().all()) {
      sender.sendMessage(Notices.info("Area: " + area));
    }
    var allowed =
        region.allow().isEmpty()
            ? "nothing"
            : region.allow().stream().map(RegionCommands::allowance).collect(joining("; "));
    sender.sendMessage(Notices.info("Players may: " + allowed));
  }

  private static String allowance(RegionAllowance allowance) {
    var subjects =
        allowance.subjects().stream()
            .map(subject -> subject.name().toLowerCase(Locale.ROOT))
            .sorted()
            .collect(joining(", "));
    return allowance.action().name().toLowerCase(Locale.ROOT) + " (" + subjects + ")";
  }
}
