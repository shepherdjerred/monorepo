package com.shepherdjerred.thestorm.shops.domain.sign;

import java.util.Arrays;
import java.util.Locale;
import java.util.stream.Collectors;

/** Readable names for items, from their material keys. */
public final class ItemNames {

  /** The widest item label a sign line shows before it is cut short. */
  public static final int SIGN_WIDTH = 15;

  /** Marks an item whose components (enchantments, name, ...) matter beyond its material. */
  public static final String SPECIAL_MARK = "*";

  private ItemNames() {}

  /** {@code DIAMOND_SWORD} or {@code minecraft:diamond_sword} becomes {@code Diamond Sword}. */
  public static String pretty(String material) {
    var key = material.contains(":") ? material.substring(material.indexOf(':') + 1) : material;
    return Arrays.stream(key.toLowerCase(Locale.ROOT).split("_"))
        .filter(word -> !word.isEmpty())
        .map(word -> Character.toUpperCase(word.charAt(0)) + word.substring(1))
        .collect(Collectors.joining(" "));
  }

  /**
   * The item line of a finished sign: the readable name, cut to fit, with {@link #SPECIAL_MARK}
   * when the shop trades a particular variant of the item. The sign's stored fingerprint, not this
   * text, identifies the item.
   */
  public static String signLabel(String material, boolean special) {
    var suffix = special ? SPECIAL_MARK : "";
    var name = pretty(material);
    var room = SIGN_WIDTH - suffix.length();
    return (name.length() > room ? name.substring(0, room).strip() : name) + suffix;
  }
}
