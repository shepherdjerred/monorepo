package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.mojang.brigadier.Command;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.builder.LiteralArgumentBuilder;
import com.shepherdjerred.thestorm.rwf.app.ExperienceSettings;
import com.shepherdjerred.thestorm.rwf.domain.kit.KitPool;
import io.papermc.paper.command.brigadier.CommandSourceStack;
import io.papermc.paper.command.brigadier.Commands;
import java.util.Arrays;
import java.util.Collection;
import java.util.Locale;
import java.util.Set;
import java.util.TreeSet;
import java.util.function.BiFunction;
import java.util.function.Supplier;
import org.bukkit.command.CommandSender;

/** Strict temporary operator overrides and a public readout of the frozen and pending settings. */
final class ExperienceCommands {
  private final MatchRunner runner;
  private final KitFactory kits;

  ExperienceCommands(MatchRunner runner, KitFactory kits) {
    this.runner = runner;
    this.kits = kits;
  }

  LiteralArgumentBuilder<CommandSourceStack> admin() {
    var command = Commands.literal("settings").executes(ctx -> read(ctx.getSource().getSender()));
    addSetting(
        command, "preset", ExperienceSettings.Preset.class, (settings, value) -> value.settings());
    addSetting(
        command,
        "difficulty",
        ExperienceSettings.Difficulty.class,
        ExperienceSettings::withDifficulty);
    addSetting(command, "style", ExperienceSettings.Style.class, ExperienceSettings::withStyle);
    addSetting(
        command, "variety", ExperienceSettings.Variety.class, ExperienceSettings::withVariety);
    command.then(
        poolSetting(
            "maps", () -> runner.rotation().playable().stream().map(MapWorld::id).toList()));
    command.then(poolSetting("kits", kits::kitIds));
    return command;
  }

  private <E extends Enum<E>> void addSetting(
      LiteralArgumentBuilder<CommandSourceStack> command,
      String name,
      Class<E> type,
      BiFunction<ExperienceSettings, E, ExperienceSettings> update) {
    var setting = Commands.literal(name);
    for (var value : type.getEnumConstants()) {
      setting.then(
          Commands.literal(value.name().toLowerCase(Locale.ROOT))
              .executes(
                  ctx -> {
                    runner
                        .experiences()
                        .select(update.apply(runner.experiences().pending(), value));
                    saved(ctx.getSource().getSender());
                    return read(ctx.getSource().getSender());
                  }));
    }
    command.then(setting);
  }

  private LiteralArgumentBuilder<CommandSourceStack> poolSetting(
      String name, Supplier<Collection<String>> available) {
    return Commands.literal(name)
        .then(
            Commands.argument("ids", StringArgumentType.greedyString())
                .suggests(
                    (ctx, builder) -> {
                      available.get().forEach(builder::suggest);
                      builder.suggest("all");
                      return builder.buildFuture();
                    })
                .executes(
                    ctx ->
                        setPool(
                            new PoolInput(
                                ctx.getSource().getSender(),
                                name,
                                StringArgumentType.getString(ctx, "ids"),
                                available.get()))));
  }

  private record PoolInput(
      CommandSender sender, String name, String text, Collection<String> available) {}

  private int setPool(PoolInput input) {
    var ids =
        input.text().equals("all")
            ? Set.<String>of()
            : Set.copyOf(Arrays.asList(input.text().trim().split("[, ]+")));
    if (!input.available().containsAll(ids)) {
      Texts.error(
          input.sender(), "Choose admitted " + input.name() + " IDs separated by spaces, or all.");
      return 0;
    }
    var pending = runner.experiences().pending();
    try {
      if (input.name().equals("kits")) {
        var checked = new KitPool(ids);
        runner.experiences().select(pending.withKits(checked.ids()));
      } else {
        runner.experiences().select(pending.withMaps(ids));
      }
    } catch (IllegalArgumentException invalid) {
      Texts.error(input.sender(), "The kit pool must include a universally available starter kit.");
      return 0;
    }
    saved(input.sender());
    return read(input.sender());
  }

  private static void saved(CommandSender sender) {
    Texts.info(sender, "Settings saved for the next draft; temporary until server restart.");
  }

  int read(CommandSender sender) {
    if (!runner.ready()) {
      Texts.info(sender, "The match is still being prepared.");
      return Command.SINGLE_SUCCESS;
    }
    runner
        .experience(runner.match().matchId())
        .ifPresent(value -> Texts.info(sender, "Current game: " + describe(value.settings())));
    Texts.info(
        sender,
        "Next draft: "
            + describe(runner.experiences().pending())
            + " Lobby size: "
            + sizing()
            + ". Changes apply when the next map ballot is created.");
    return Command.SINGLE_SUCCESS;
  }

  private static String describe(ExperienceSettings settings) {
    return settings.difficulty().name().toLowerCase(Locale.ROOT)
        + " difficulty, "
        + settings.style().name().toLowerCase(Locale.ROOT)
        + " style, "
        + settings.variety().name().toLowerCase(Locale.ROOT)
        + " variety. Maps: "
        + pool(settings.maps())
        + "; kits: "
        + pool(settings.kits())
        + ".";
  }

  private static String pool(Set<String> ids) {
    return ids.isEmpty() ? "all" : String.join(", ", new TreeSet<>(ids));
  }

  private String sizing() {
    var selection = runner.lobbySizes().selection();
    return switch (selection.mode()) {
      case AUTO -> "automatic (large)";
      case TEAM -> selection.count() + " players per team";
      case FIXED -> selection.count() + " players total";
      default -> selection.mode().name().toLowerCase(Locale.ROOT);
    };
  }
}
