package com.shepherdjerred.thestorm.shards.adapter.paper;

import com.mojang.brigadier.Command;
import com.mojang.brigadier.arguments.IntegerArgumentType;
import com.mojang.brigadier.context.CommandContext;
import com.mojang.brigadier.exceptions.CommandSyntaxException;
import com.mojang.brigadier.tree.LiteralCommandNode;
import com.shepherdjerred.thestorm.shards.domain.Bonuses;
import com.shepherdjerred.thestorm.shards.domain.Opponent;
import com.shepherdjerred.thestorm.shards.domain.StormPiece;
import com.shepherdjerred.thestorm.shards.domain.StormTier;
import com.shepherdjerred.thestorm.shards.domain.Upgrades;
import io.papermc.paper.command.brigadier.CommandSourceStack;
import io.papermc.paper.command.brigadier.Commands;
import io.papermc.paper.command.brigadier.argument.ArgumentTypes;
import io.papermc.paper.command.brigadier.argument.resolvers.selector.PlayerSelectorArgumentResolver;
import net.kyori.adventure.text.minimessage.tag.resolver.Placeholder;
import org.bukkit.entity.Player;

/**
 * {@code /shards}: help, {@code /shards info} for the held item, and the admin-only {@code /shards
 * give <player> <amount>}.
 */
final class ShardsCommand {

  static final String ADMIN_PERMISSION = "thestorm.shards.admin";

  /** Up to a full inventory of stacks. */
  private static final int MAX_GIVE = 64 * 36;

  private final ShardKit kit;
  private final Bonuses bonuses;
  private final Upgrades upgrades;

  ShardsCommand(ShardKit kit, Bonuses bonuses, Upgrades upgrades) {
    this.kit = kit;
    this.bonuses = bonuses;
    this.upgrades = upgrades;
  }

  LiteralCommandNode<CommandSourceStack> node() {
    return Commands.literal("shards")
        .executes(this::help)
        .then(Commands.literal("info").executes(this::info))
        .then(
            Commands.literal("give")
                .requires(source -> source.getSender().hasPermission(ADMIN_PERMISSION))
                .then(
                    Commands.argument("player", ArgumentTypes.player())
                        .then(
                            Commands.argument("amount", IntegerArgumentType.integer(1, MAX_GIVE))
                                .executes(this::give))))
        .build();
  }

  private int help(CommandContext<CommandSourceStack> context) {
    var sender = context.getSource().getSender();
    kit.text().messages().help().forEach(line -> kit.text().info(sender, line));
    return Command.SINGLE_SUCCESS;
  }

  private int info(CommandContext<CommandSourceStack> context) {
    if (!(context.getSource().getExecutor() instanceof Player player)) {
      kit.text().error(context.getSource().getSender(), "Only players hold items.");
      return 0;
    }
    var messages = kit.text().messages();
    var item = player.getInventory().getItemInMainHand();
    var category = kit.gear().categoryOf(item);
    if (category.isEmpty()) {
      kit.text().info(player, messages.infoNotUpgradeable());
      return Command.SINGLE_SUCCESS;
    }
    var tier = kit.gear().tierOf(item);
    if (tier.isEmpty()) {
      kit.text()
          .info(
              player,
              messages.infoUnupgraded(),
              ShardText.number("cost", upgrades.cost(StormTier.first())));
      return Command.SINGLE_SUCCESS;
    }
    var piece = new StormPiece(category.get(), tier.get());
    kit.text()
        .info(
            player,
            piece.category().isArmor() ? messages.infoArmor() : messages.infoWeapon(),
            ShardText.tier(piece.tier()),
            ShardText.percent("pve", bonuses.bonusAgainst(piece, Opponent.MOB)),
            ShardText.percent("pvp", bonuses.bonusAgainst(piece, Opponent.PLAYER)));
    return Command.SINGLE_SUCCESS;
  }

  private int give(CommandContext<CommandSourceStack> context) throws CommandSyntaxException {
    var target =
        context
            .getArgument("player", PlayerSelectorArgumentResolver.class)
            .resolve(context.getSource())
            .getFirst();
    var amount = IntegerArgumentType.getInteger(context, "amount");
    kit.shards().give(target, amount);
    var messages = kit.text().messages();
    kit.text().success(target, messages.received(), ShardText.number("amount", amount));
    kit.text()
        .success(
            context.getSource().getSender(),
            messages.given(),
            ShardText.number("amount", amount),
            Placeholder.unparsed("player", target.getName()));
    return Command.SINGLE_SUCCESS;
  }
}
