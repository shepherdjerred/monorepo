package com.shepherdjerred.thestorm.arena.adapter.paper;

import com.mojang.brigadier.arguments.IntegerArgumentType;
import com.mojang.brigadier.arguments.StringArgumentType;
import io.papermc.paper.command.brigadier.Commands;
import java.util.function.Consumer;
import org.bukkit.entity.Player;

/** Abilities, progression and explicit personal resource donations. */
final class SurvivalCommands {
  private final Arenas arenas;

  SurvivalCommands(Arenas arenas) {
    this.arenas = arenas;
  }

  void register(Commands commands) {
    commands.register(
        Commands.literal("survival")
            .requires(source -> source.getSender().hasPermission(ArenaPermissions.PLAY))
            .then(
                Commands.literal("tips")
                    .then(
                        Commands.literal("on")
                            .executes(
                                c ->
                                    player(
                                        c.getSource().getSender(),
                                        p -> runner(p, r -> r.tips().setting(p, "on")))))
                    .then(
                        Commands.literal("off")
                            .executes(
                                c ->
                                    player(
                                        c.getSource().getSender(),
                                        p -> runner(p, r -> r.tips().setting(p, "off")))))
                    .then(
                        Commands.literal("reset")
                            .executes(
                                c ->
                                    player(
                                        c.getSource().getSender(),
                                        p -> runner(p, r -> r.tips().setting(p, "reset"))))))
            .then(
                Commands.literal("guide")
                    .executes(
                        c ->
                            player(
                                c.getSource().getSender(), p -> runner(p, r -> r.guide().open(p)))))
            .then(
                Commands.literal("classes")
                    .executes(
                        c ->
                            player(
                                c.getSource().getSender(),
                                p -> runner(p, r -> r.classMenus().classes(p)))))
            .then(
                Commands.literal("upgrades")
                    .executes(
                        c ->
                            player(
                                c.getSource().getSender(),
                                p -> runner(p, r -> r.classMenus().upgrades(p)))))
            .then(
                Commands.literal("ability")
                    .executes(
                        c ->
                            player(
                                c.getSource().getSender(),
                                p -> runner(p, r -> r.actions().ability(p)))))
            .then(
                Commands.literal("status")
                    .executes(
                        c ->
                            player(
                                c.getSource().getSender(),
                                p ->
                                    runner(
                                        p,
                                        r ->
                                            Texts.info(
                                                p,
                                                "Round "
                                                    + r.game().round()
                                                    + " | XP "
                                                    + r.xp(p.getUniqueId())
                                                    + " | Emeralds "
                                                    + r.items()
                                                        .count(p, org.bukkit.Material.EMERALD)
                                                    + " | Open routes "
                                                    + r.map().state().open())))))
            .then(
                Commands.literal("give")
                    .then(
                        Commands.argument("player", StringArgumentType.word())
                            .then(
                                Commands.argument("item", StringArgumentType.word())
                                    .then(
                                        Commands.argument(
                                                "amount", IntegerArgumentType.integer(1, 64))
                                            .executes(
                                                c ->
                                                    player(
                                                        c.getSource().getSender(),
                                                        p ->
                                                            runner(
                                                                p,
                                                                r -> {
                                                                  var target =
                                                                      p.getServer()
                                                                          .getPlayerExact(
                                                                              StringArgumentType
                                                                                  .getString(
                                                                                      c, "player"));
                                                                  if (target == null) {
                                                                    Texts.error(
                                                                        p,
                                                                        "That teammate is offline.");
                                                                    return;
                                                                  }
                                                                  org.bukkit.Material item;
                                                                  try {
                                                                    item =
                                                                        SurvivalItems.material(
                                                                            StringArgumentType
                                                                                .getString(
                                                                                    c, "item"));
                                                                  } catch (
                                                                      IllegalArgumentException
                                                                          error) {
                                                                    Texts.error(p, "Unknown item.");
                                                                    return;
                                                                  }
                                                                  r.actions()
                                                                      .donate(
                                                                          p,
                                                                          target,
                                                                          item,
                                                                          IntegerArgumentType
                                                                              .getInteger(
                                                                                  c, "amount"));
                                                                })))))))
            .build(),
        "Survival arenas: classes, upgrades, ability, status, give <player> <item> <amount>");
  }

  private static int player(org.bukkit.command.CommandSender sender, Consumer<Player> action) {
    if (sender instanceof Player player) {
      action.accept(player);
      return 1;
    }
    Texts.error(sender, "Players only.");
    return 0;
  }

  private void runner(Player player, Consumer<SurvivalRunner> action) {
    arenas
        .of(player.getUniqueId())
        .filter(SurvivalRunner.class::isInstance)
        .map(SurvivalRunner.class::cast)
        .ifPresentOrElse(
            action,
            () -> Texts.error(player, "Join a survival map: /arena join settlement or rustworks."));
  }
}
