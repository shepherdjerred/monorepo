package com.shepherdjerred.thestorm.core.text;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextColor;

/**
 * The Storm's message style, unchanged since 2015: {@code [Label]: message} with a dark gray frame,
 * the brand teal label, and a gray, red or green body.
 */
public final class HouseStyle {

  /** The Storm's brand teal. */
  public static final TextColor BRAND = TextColor.color(0x4DCCC4);

  private HouseStyle() {}

  public static Component info(String label, Component message) {
    return prefix(label).append(message.colorIfAbsent(NamedTextColor.GRAY));
  }

  public static Component success(String label, Component message) {
    return prefix(label).append(message.colorIfAbsent(NamedTextColor.GREEN));
  }

  public static Component error(String label, Component message) {
    return prefix(label).append(message.colorIfAbsent(NamedTextColor.RED));
  }

  private static Component prefix(String label) {
    return Component.text("[", NamedTextColor.DARK_GRAY)
        .append(Component.text(label, BRAND))
        .append(Component.text("]: ", NamedTextColor.DARK_GRAY));
  }
}
