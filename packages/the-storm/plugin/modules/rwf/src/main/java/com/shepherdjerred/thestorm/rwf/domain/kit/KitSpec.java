// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/game/searchanddestroy/kits/SnDKit.java
// and redwarfare-arcade/src/me/libraryaddict/arcade/kits/Kit.java); see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.kit;

import com.shepherdjerred.thestorm.rwf.domain.bomb.FuseBonus;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.List;
import java.util.Optional;
import java.util.regex.Pattern;

/**
 * A Search and Destroy kit: what a player is given and what it costs. Every kit's first hotbar slot
 * is the Blaze Powder "Bomb Fuse", carrying the kit's fuse bonus if it has one.
 *
 * @param id a stable id such as {@code trooper}
 * @param name the display name
 * @param description the kit menu text
 * @param price credits to buy it; 0 for free kits
 * @param availability who may pick it
 * @param fuseBonus the bonus on the kit's Bomb Fuse, if any
 * @param hotbar the items after the fuse, in slot order
 * @param armor the armor worn, at most one piece per slot
 * @param ability the pure ability the kit carries, if any; see the module's KITS.md
 * @param menu how the kit menu and the lobby's alcove show it
 */
public record KitSpec(
    String id,
    String name,
    String description,
    int price,
    KitAvailability availability,
    Optional<FuseBonus> fuseBonus,
    List<ItemSpec> hotbar,
    List<ItemSpec> armor,
    Optional<String> ability,
    Menu menu) {

  /** The fuse every kit carries in slot 0. */
  public static final ItemSpec FUSE = ItemSpec.of("BLAZE_POWDER").named("Bomb Fuse");

  private static final Pattern ID = Pattern.compile("[a-z][a-z0-9-]*");

  public KitSpec {
    if (!ID.matcher(id).matches()) {
      throw new IllegalArgumentException("kit id must be lower-case kebab-case: " + id);
    }
    if (name.isBlank() || description.isBlank()) {
      throw new IllegalArgumentException("kit name and description must not be blank");
    }
    if (price < 0) {
      throw new IllegalArgumentException("price must not be negative: " + price);
    }
    if ((price > 0) != (availability == KitAvailability.PURCHASE)) {
      throw new IllegalArgumentException("a kit is PURCHASE exactly when it has a price: " + id);
    }
    hotbar = List.copyOf(hotbar);
    armor = List.copyOf(armor);
    if (hotbar.stream().anyMatch(item -> item.slot().isPresent())) {
      throw new IllegalArgumentException("hotbar items must not name an armor slot: " + id);
    }
    var slots = EnumSet.noneOf(ArmorSlot.class);
    for (var piece : armor) {
      var slot =
          piece
              .slot()
              .orElseThrow(() -> new IllegalArgumentException("armor must name its slot: " + id));
      if (!slots.add(slot)) {
        throw new IllegalArgumentException(id + " wears two pieces in " + slot);
      }
    }
  }

  /**
   * How a kit is shown in the kit menu and its lobby alcove.
   *
   * @param icon the material of its menu icon and alcove item, such as {@code BOW}
   * @param summary one to four short lines of what it carries and does, shown as the icon's lore
   */
  public record Menu(String icon, List<String> summary) {

    /** The longest summary line, in characters, so the lore fits a tooltip. */
    public static final int LINE_LENGTH = 40;

    private static final int MAX_LINES = 4;
    private static final Pattern MATERIAL = Pattern.compile("[A-Z][A-Z0-9_]*");

    public Menu {
      if (!MATERIAL.matcher(icon).matches()) {
        throw new IllegalArgumentException("icon must be a material such as BOW: " + icon);
      }
      summary = List.copyOf(summary);
      if (summary.isEmpty() || summary.size() > MAX_LINES) {
        throw new IllegalArgumentException("a kit summary has 1 to " + MAX_LINES + " lines");
      }
      for (var line : summary) {
        if (line.isBlank() || line.length() > LINE_LENGTH) {
          throw new IllegalArgumentException(
              "summary lines must be 1 to " + LINE_LENGTH + " characters: " + line);
        }
      }
    }
  }

  /** Everything in the hotbar, the fuse first. */
  public List<ItemSpec> items() {
    var items = new ArrayList<ItemSpec>();
    items.add(FUSE);
    items.addAll(hotbar);
    return List.copyOf(items);
  }
}
