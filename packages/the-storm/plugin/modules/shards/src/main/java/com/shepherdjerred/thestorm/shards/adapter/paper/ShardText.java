package com.shepherdjerred.thestorm.shards.adapter.paper;

import com.shepherdjerred.thestorm.core.text.HouseStyle;
import com.shepherdjerred.thestorm.shards.domain.Percent;
import com.shepherdjerred.thestorm.shards.domain.ShardMessages;
import com.shepherdjerred.thestorm.shards.domain.StormTier;
import io.papermc.paper.datacomponent.DataComponentTypes;
import net.kyori.adventure.audience.Audience;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.TextDecoration;
import net.kyori.adventure.text.minimessage.MiniMessage;
import net.kyori.adventure.text.minimessage.tag.resolver.Placeholder;
import net.kyori.adventure.text.minimessage.tag.resolver.TagResolver;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.inventory.ItemStack;

/** Renders the configured MiniMessage templates in the house style. */
final class ShardText {

  /** The house-style label on messages to one player. */
  static final String LABEL = "Shards";

  /** The house-style label on server-wide announcements. */
  static final String BROADCAST_LABEL = "Storm";

  private static final MiniMessage MINI_MESSAGE = MiniMessage.miniMessage();

  private final ShardMessages messages;
  private final String loreLine;

  ShardText(ShardMessages messages, String loreLine) {
    this.messages = messages;
    this.loreLine = loreLine;
  }

  ShardMessages messages() {
    return messages;
  }

  /** Parses a template; placeholders fill {@code <name>} tags. */
  static Component render(String template, TagResolver... placeholders) {
    return MINI_MESSAGE.deserialize(template, placeholders);
  }

  /** Item text: rendered without the default italic of custom names and lore. */
  static Component itemText(String template, TagResolver... placeholders) {
    return render(template, placeholders)
        .decorationIfAbsent(TextDecoration.ITALIC, TextDecoration.State.FALSE);
  }

  /** The lore line upgraded gear shows for {@code tier}. */
  Component loreLine(StormTier tier) {
    return itemText(loreLine, tier(tier));
  }

  /** Whether {@code line} is a Storm lore line of any tier (compared as plain text). */
  boolean isLoreLine(Component line) {
    var plain = PlainTextComponentSerializer.plainText().serialize(line);
    for (var level = 1; level <= StormTier.MAX_LEVEL; level++) {
      var candidate =
          PlainTextComponentSerializer.plainText().serialize(loreLine(new StormTier(level)));
      if (candidate.equals(plain)) {
        return true;
      }
    }
    return false;
  }

  void info(Audience audience, String template, TagResolver... placeholders) {
    audience.sendMessage(HouseStyle.info(LABEL, render(template, placeholders)));
  }

  void success(Audience audience, String template, TagResolver... placeholders) {
    audience.sendMessage(HouseStyle.success(LABEL, render(template, placeholders)));
  }

  void error(Audience audience, String template, TagResolver... placeholders) {
    audience.sendMessage(HouseStyle.error(LABEL, render(template, placeholders)));
  }

  /**
   * The item's name as players see it, by vanilla's rule: an anvil name ({@code custom_name}), else
   * the item's own {@code item_name}, else the material's translated name.
   */
  static TagResolver itemName(ItemStack item) {
    var custom = item.getData(DataComponentTypes.CUSTOM_NAME);
    var name = custom != null ? custom : item.getData(DataComponentTypes.ITEM_NAME);
    return Placeholder.component(
        "item", name != null ? name : Component.translatable(item.getType()));
  }

  static TagResolver tier(StormTier tier) {
    return Placeholder.unparsed("tier", tier.numeral());
  }

  static TagResolver number(String name, int value) {
    return Placeholder.unparsed(name, Integer.toString(value));
  }

  static TagResolver percent(String name, double fraction) {
    return Placeholder.unparsed(name, Percent.format(fraction));
  }
}
