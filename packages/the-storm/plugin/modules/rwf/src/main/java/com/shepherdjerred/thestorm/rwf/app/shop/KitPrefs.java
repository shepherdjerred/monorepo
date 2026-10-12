package com.shepherdjerred.thestorm.rwf.app.shop;

import com.shepherdjerred.thestorm.rwf.domain.kit.KitLayout;
import java.util.Map;
import java.util.Optional;

/**
 * What a player keeps between matches about their kits.
 *
 * @param lastKit the kit they last played, picked for them again when they join
 * @param layouts each kit's saved layout, by kit id
 */
public record KitPrefs(Optional<String> lastKit, Map<String, KitLayout> layouts) {

  /** Nothing kept yet. */
  public static final KitPrefs NONE = new KitPrefs(Optional.empty(), Map.of());

  public KitPrefs {
    layouts = Map.copyOf(layouts);
  }

  /** {@code kit}'s saved layout, if any. */
  public Optional<KitLayout> layout(String kit) {
    return Optional.ofNullable(layouts.get(kit));
  }
}
