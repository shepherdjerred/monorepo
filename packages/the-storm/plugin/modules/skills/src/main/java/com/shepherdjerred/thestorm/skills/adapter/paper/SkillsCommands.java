package com.shepherdjerred.thestorm.skills.adapter.paper;

import static com.mojang.brigadier.arguments.StringArgumentType.getString;
import static com.mojang.brigadier.arguments.StringArgumentType.word;

import com.mojang.brigadier.Command;
import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.skills.app.SkillLevels;
import com.shepherdjerred.thestorm.skills.app.SkillProgress;
import com.shepherdjerred.thestorm.skills.domain.Experience;
import com.shepherdjerred.thestorm.skills.domain.Skill;
import com.shepherdjerred.thestorm.skills.domain.SkillsConfig;
import io.papermc.paper.command.brigadier.Commands;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import net.kyori.adventure.text.Component;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;

/** /skills shows levels and progress; /skills top ranks permanent power levels. */
final class SkillsCommands {

  private final ModuleContext context;
  private final SkillLevels levels;
  private final SkillsConfig config;

  SkillsCommands(ModuleContext context, SkillLevels levels, SkillsConfig config) {
    this.context = context;
    this.levels = levels;
    this.config = config;
  }

  void register(Commands commands) {
    commands.register(
        Commands.literal("skills")
            .executes(source -> overview(source.getSource().getSender()))
            .then(Commands.literal("top").executes(source -> top(source.getSource().getSender())))
            .then(
                Commands.argument("skill", word())
                    .suggests(
                        (source, suggestions) -> {
                          var prefix = suggestions.getRemainingLowerCase();
                          for (var skill : Skill.values()) {
                            var name = skill.name().toLowerCase(Locale.ROOT);
                            if (name.startsWith(prefix)) {
                              suggestions.suggest(name);
                            }
                          }
                          return suggestions.buildFuture();
                        })
                    .executes(
                        source ->
                            detail(source.getSource().getSender(), getString(source, "skill"))))
            .build(),
        "Shows your skill progression and power-level leaderboard",
        List.of("mcmmo"));
  }

  private int overview(CommandSender sender) {
    if (!(sender instanceof Player player)) {
      sender.sendMessage(Component.text("Use /skills in game."));
      return Command.SINGLE_SUCCESS;
    }
    var _ =
        levels
            .progress(player.getUniqueId())
            .whenCompleteAsync(
                (progress, failure) -> {
                  if (failure != null) {
                    error(sender, failure);
                    return;
                  }
                  sender.sendMessage(Component.text("Power level: " + progress.powerLevel()));
                  for (var skill : Skill.values()) {
                    sender.sendMessage(
                        Component.text(skill.displayName() + ": " + progress.level(skill)));
                  }
                },
                context.scheduler().mainThread());
    return Command.SINGLE_SUCCESS;
  }

  private int detail(CommandSender sender, String input) {
    if (!(sender instanceof Player player)) {
      sender.sendMessage(Component.text("Use /skills in game."));
      return Command.SINGLE_SUCCESS;
    }
    var skill =
        Arrays.stream(Skill.values())
            .filter(value -> value.name().equalsIgnoreCase(input))
            .findFirst();
    if (skill.isEmpty()) {
      sender.sendMessage(Component.text("Unknown skill: " + input));
      return Command.SINGLE_SUCCESS;
    }
    var _ =
        levels
            .progress(player.getUniqueId())
            .whenCompleteAsync(
                (progress, failure) -> {
                  if (failure != null) {
                    error(sender, failure);
                    return;
                  }
                  showDetail(sender, skill.orElseThrow(), progress);
                },
                context.scheduler().mainThread());
    return Command.SINGLE_SUCCESS;
  }

  private static void showDetail(CommandSender sender, Skill skill, SkillProgress progress) {
    int level = progress.level(skill);
    long current = progress.experience().getOrDefault(skill, 0L);
    if (level == Experience.MAX_LEVEL) {
      sender.sendMessage(Component.text(skill.displayName() + ": level 1000 (maximum)"));
      return;
    }
    long next = Experience.required(level + 1);
    sender.sendMessage(
        Component.text(
            skill.displayName() + ": level " + level + " (" + current + "/" + next + " XP)"));
  }

  private int top(CommandSender sender) {
    var _ =
        levels
            .top(config.leaderboardSize())
            .whenCompleteAsync(
                (ranking, failure) -> {
                  if (failure != null) {
                    error(sender, failure);
                    return;
                  }
                  sender.sendMessage(Component.text("Power level leaderboard"));
                  for (int i = 0; i < ranking.size(); i++) {
                    var player = ranking.get(i);
                    sender.sendMessage(
                        Component.text(
                            (i + 1) + ". " + player.name() + " — " + player.powerLevel()));
                  }
                },
                context.scheduler().mainThread());
    return Command.SINGLE_SUCCESS;
  }

  private void error(CommandSender sender, Throwable failure) {
    context.logger().error("Skills command failed", failure);
    sender.sendMessage(Component.text("Skills are temporarily unavailable."));
  }
}
