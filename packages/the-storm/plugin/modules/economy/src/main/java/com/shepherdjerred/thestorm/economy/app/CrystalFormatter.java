package com.shepherdjerred.thestorm.economy.app;

/**
 * Formats crystal amounts with the currency names from {@code economy.yml}, so every module writes
 * prices the same way. Obtain it with {@code context.services().require(CrystalFormatter.class)}.
 */
public interface CrystalFormatter {

  /** For sentences: "1 crystal", "1,250 crystals". */
  String words(Crystals amount);

  /** Compact, for lists and holograms: "1,250 CR". */
  String symbol(Crystals amount);
}
