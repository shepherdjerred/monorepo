package com.shepherdjerred.thestorm.economy.app;

/**
 * Formats amounts with each currency's names from {@code economy.yml}, so every module writes
 * prices the same way. Obtain it with {@code context.services().require(MoneyFormatter.class)}.
 */
public interface MoneyFormatter {

  /** For sentences: "1 crystal", "1,250 crystals", "3 Credits". */
  String words(Money amount);

  /** Compact, for lists and holograms: "1,250 CR", "3 RC". */
  String symbol(Money amount);
}
