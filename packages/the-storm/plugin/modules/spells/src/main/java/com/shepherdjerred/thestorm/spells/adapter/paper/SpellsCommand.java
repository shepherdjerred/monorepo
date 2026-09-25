package com.shepherdjerred.thestorm.spells.adapter.paper;

import static com.mojang.brigadier.arguments.IntegerArgumentType.getInteger;
import static com.mojang.brigadier.arguments.IntegerArgumentType.integer;
import static com.mojang.brigadier.arguments.StringArgumentType.getString;
import static com.mojang.brigadier.arguments.StringArgumentType.word;

import com.mojang.brigadier.Command;
import com.mojang.brigadier.context.CommandContext;
import com.mojang.brigadier.exceptions.CommandSyntaxException;
import com.mojang.brigadier.suggestion.Suggestions;
import com.mojang.brigadier.suggestion.SuggestionsBuilder;
import com.mojang.brigadier.tree.LiteralCommandNode;
import com.shepherdjerred.thestorm.spells.domain.RefusalText;
import com.shepherdjerred.thestorm.spells.domain.SpellKind;
import com.shepherdjerred.thestorm.spells.domain.config.SpellsConfig;
import io.papermc.paper.command.brigadier.CommandSourceStack;
import io.papermc.paper.command.brigadier.Commands;
import io.papermc.paper.command.brigadier.argument.ArgumentTypes;
import io.papermc.paper.command.brigadier.argument.resolvers.selector.PlayerSelectorArgumentResolver;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.function.Predicate;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;

/**
 * {@code /spells}: lists the spells and whether the sender can use each; {@code /spells bind
 * <spell>} gives a focus for a spell the sender knows; {@code /spells info <spell>} describes one;
 * administrators' {@code /spells scroll <spell> <player> [amount]} gives single-use scrolls.
 */
final class SpellsCommand {

  private static final String SPELL = "spell";
  private static final String PLAYER = "player";
  private static final String AMOUNT = "amount";

  private final SpellsConfig config;
  private final SpellItems items;
  private final Binder binder;
  private final Say say;

  SpellsCommand(SpellsConfig config, SpellItems items, Binder binder, Say say) {
    this.config = config;
    this.items = items;
    this.binder = binder;
    this.say = say;
  }

  void register(Commands commands) {
    commands.register(node(), "Lists, binds and describes spells");
  }

  private LiteralCommandNode<CommandSourceStack> node() {
    return Commands.literal("spells")
        .executes(context -> list(context.getSource().getSender()))
        .then(
            Commands.literal("bind")
                .then(
                    Commands.argument(SPELL, word())
                        .suggests(
                            (context, builder) ->
                                suggest(
                                    builder, kind -> knows(context.getSource().getSender(), kind)))
                        .executes(
                            context ->
                                bind(context.getSource().getSender(), getString(context, SPELL)))))
        .then(
            Commands.literal("info")
                .then(
                    Commands.argument(SPELL, word())
                        .suggests((context, builder) -> suggest(builder, kind -> true))
                        .executes(
                            context ->
                                info(context.getSource().getSender(), getString(context, SPELL)))))
        .then(
            Commands.literal("scroll")
                .requires(source -> source.getSender().hasPermission(Access.ADMIN))
                .then(
                    Commands.argument(SPELL, word())
                        .suggests((context, builder) -> suggest(builder, kind -> true))
                        .then(
                            Commands.argument(PLAYER, ArgumentTypes.player())
                                .executes(context -> scroll(context, 1))
                                .then(
                                    Commands.argument(
                                            AMOUNT, integer(1, config.scroll().maxStack()))
                                        .executes(
                                            context ->
                                                scroll(context, getInteger(context, AMOUNT)))))))
        .build();
  }

  private CompletableFuture<Suggestions> suggest(
      SuggestionsBuilder builder, Predicate<SpellKind> include) {
    var prefix = builder.getRemainingLowerCase();
    Arrays.stream(SpellKind.values())
        .filter(kind -> config.spells().entry(kind).enabled())
        .filter(include)
        .map(SpellKind::id)
        .filter(id -> id.startsWith(prefix))
        .forEach(builder::suggest);
    return builder.buildFuture();
  }

  /** True when {@code sender} is a player who may bind {@code kind}. */
  private boolean knows(CommandSender sender, SpellKind kind) {
    return sender instanceof Player player && binder.access(player, kind).isEmpty();
  }

  private int list(CommandSender sender) {
    say.info(sender, "Spells (" + (sender instanceof Player ? "yours in green" : "all") + "):");
    for (var kind : SpellKind.values()) {
      var entry = config.spells().entry(kind);
      if (!entry.enabled()) {
        continue;
      }
      var usable = knows(sender, kind);
      var status =
          "Spellcaster " + RefusalText.roman(entry.tier()) + (entry.learned() ? ", quest" : "");
      sender.sendMessage(
          Component.text(" " + kind.id() + " ", usable ? NamedTextColor.GREEN : NamedTextColor.GRAY)
              .append(SpellItems.text(entry.look().name()))
              .append(Component.text(" · " + status, NamedTextColor.DARK_GRAY)));
    }
    return Command.SINGLE_SUCCESS;
  }

  private int bind(CommandSender sender, String id) {
    if (!(sender instanceof Player player)) {
      say.error(sender, "Only players can bind a focus.");
      return 0;
    }
    var kind = SpellKind.byId(id);
    if (kind.isEmpty()) {
      say.error(sender, "There is no spell called " + id + ".");
      return 0;
    }
    var refused = binder.bind(player, kind.get());
    if (refused.isPresent()) {
      say.refusal(player, refused.get());
      return 0;
    }
    say.success(player, "Your " + kind.get().id() + " focus is ready. Right-click to cast.");
    return Command.SINGLE_SUCCESS;
  }

  private int info(CommandSender sender, String id) {
    var kind = SpellKind.byId(id);
    if (kind.isEmpty()) {
      say.error(sender, "There is no spell called " + id + ".");
      return 0;
    }
    var entry = config.spells().entry(kind.get());
    sender.sendMessage(SpellItems.text(entry.look().name()));
    for (var line : entry.look().lore()) {
      sender.sendMessage(SpellItems.text(line));
    }
    var cost = entry.reagents().isEmpty() ? "nothing" : RefusalText.reagents(entry.reagents());
    say.info(
        sender,
        "Spellcaster "
            + RefusalText.roman(entry.tier())
            + (entry.learned() ? " (learned in a quest)" : "")
            + " · costs "
            + cost
            + " · cooldown "
            + RefusalText.seconds(entry.cooldown())
            + (entry.enabled() ? "" : " · disabled"));
    return Command.SINGLE_SUCCESS;
  }

  private int scroll(CommandContext<CommandSourceStack> context, int amount)
      throws CommandSyntaxException {
    var sender = context.getSource().getSender();
    var id = getString(context, SPELL);
    var kind = SpellKind.byId(id);
    if (kind.isEmpty()) {
      say.error(sender, "There is no spell called " + id + ".");
      return 0;
    }
    List<Player> targets =
        context
            .getArgument(PLAYER, PlayerSelectorArgumentResolver.class)
            .resolve(context.getSource());
    for (var target : targets) {
      var scrolls = items.scrollOf(kind.get(), amount);
      for (var left : target.getInventory().addItem(scrolls).values()) {
        target.getWorld().dropItemNaturally(target.getEyeLocation(), left);
      }
      say.success(sender, "Gave " + target.getName() + " " + amount + " " + id + " scroll(s).");
    }
    return Command.SINGLE_SUCCESS;
  }
}
