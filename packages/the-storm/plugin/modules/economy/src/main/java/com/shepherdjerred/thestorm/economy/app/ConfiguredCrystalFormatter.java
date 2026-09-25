package com.shepherdjerred.thestorm.economy.app;

import com.shepherdjerred.thestorm.economy.domain.CrystalFormat;

/**
 * The published {@link CrystalFormatter}: the domain's formatting with the currency names from
 * {@code economy.yml}, grouping thousands with commas whatever the server's locale.
 */
public final class ConfiguredCrystalFormatter implements CrystalFormatter {

  private final CrystalFormat format;

  public ConfiguredCrystalFormatter(CrystalFormat format) {
    this.format = format;
  }

  @Override
  public String words(Crystals amount) {
    return format.words(amount);
  }

  @Override
  public String symbol(Crystals amount) {
    return format.symbol(amount);
  }
}
