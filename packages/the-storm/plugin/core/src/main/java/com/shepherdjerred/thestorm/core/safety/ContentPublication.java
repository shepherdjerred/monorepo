package com.shepherdjerred.thestorm.core.safety;

import java.util.function.Supplier;

/** Captures admission mode through synchronous native chat and command publication. */
public final class ContentPublication {
  private static final ScopedValue<Boolean> SCREENED = ScopedValue.newInstance();

  private ContentPublication() {}

  /** Native publications outside Safety retain the existing enforcement flow. */
  public static boolean screened() {
    return SCREENED.isBound() && SCREENED.get();
  }

  public static String deliver(boolean screened, Supplier<String> publication) {
    return ScopedValue.where(SCREENED, screened).call(publication::get);
  }
}
