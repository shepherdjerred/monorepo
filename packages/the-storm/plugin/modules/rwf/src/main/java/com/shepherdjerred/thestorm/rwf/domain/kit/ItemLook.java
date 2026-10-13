// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/game/searchanddestroy/kits/*.java, the
// ItemBuilder titles, lore, colours and dull enchants); see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.kit;

import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * How a kit item looks, beyond what it is: Red Warfare coloured item names, wrote lore under some,
 * gave a few a glint without an enchantment and dyed leather and firework stars.
 *
 * @param nameColor the colour of the item's display name, one of the sixteen chat colours by its
 *     lower-case name such as {@code gold}
 * @param lore lines under the name, in {@code loreColor}; an empty line is a gap
 * @param loreColor the colour of every lore line; present exactly when there is lore
 * @param glint whether the item shimmers as if enchanted
 * @param dye a leather, firework-star or potion colour as {@code #RRGGBB}, or {@code team} for the
 *     wearer's team colour
 */
public record ItemLook(
    Optional<String> nameColor,
    List<String> lore,
    Optional<String> loreColor,
    boolean glint,
    Optional<String> dye) {

  /** No colour, lore, glint or dye. */
  public static final ItemLook PLAIN =
      new ItemLook(Optional.empty(), List.of(), Optional.empty(), false, Optional.empty());

  /** The dye that takes the wearer's team colour. */
  public static final String TEAM_DYE = "team";

  /** The sixteen chat colours, as Adventure names them. */
  public static final Set<String> COLORS =
      Set.of(
          "black",
          "dark_blue",
          "dark_green",
          "dark_aqua",
          "dark_red",
          "dark_purple",
          "gold",
          "gray",
          "dark_gray",
          "blue",
          "green",
          "aqua",
          "red",
          "light_purple",
          "yellow",
          "white");

  private static final Pattern HEX = Pattern.compile("#[0-9A-F]{6}");

  public ItemLook {
    lore = List.copyOf(lore);
    nameColor.ifPresent(ItemLook::requireColor);
    loreColor.ifPresent(ItemLook::requireColor);
    if (lore.isEmpty() == loreColor.isPresent()) {
      throw new IllegalArgumentException("a lore colour is given exactly when there is lore");
    }
    dye.ifPresent(
        value -> {
          if (!TEAM_DYE.equals(value) && !HEX.matcher(value).matches()) {
            throw new IllegalArgumentException("dye must be #RRGGBB or team: " + value);
          }
        });
  }

  private static void requireColor(String color) {
    if (!COLORS.contains(color)) {
      throw new IllegalArgumentException("unknown chat colour: " + color);
    }
  }

  public ItemLook withNameColor(String color) {
    return new ItemLook(Optional.of(color), lore, loreColor, glint, dye);
  }

  public ItemLook withLore(String color, List<String> lines) {
    return new ItemLook(nameColor, lines, Optional.of(color), glint, dye);
  }

  public ItemLook withGlint() {
    return new ItemLook(nameColor, lore, loreColor, true, dye);
  }

  public ItemLook withDye(String value) {
    return new ItemLook(nameColor, lore, loreColor, glint, Optional.of(value));
  }

  /** The dye as an RGB integer, for a fixed hex dye. */
  public static int rgb(String hex) {
    return Integer.parseInt(hex.substring(1), 16);
  }
}
