package com.shepherdjerred.thestorm.npcs.domain.content;

import com.shepherdjerred.thestorm.npcs.domain.geo.Spot;
import java.util.Locale;

/** YAML fragments for admins to paste into content files. */
public final class Snippets {

  private Snippets() {}

  /**
   * A {@code home:} block for NPC {@code id} standing at {@code spot}, positions to hundredths and
   * angles to tenths of a degree, in the block style Prettier keeps as written.
   */
  public static String home(String id, Spot spot) {
    return "# npcs." + id + "\nhome:\n" + spot(spot, "  ");
  }

  /** A spot's keys, one per line, each line starting with {@code indent}. */
  public static String spot(Spot spot, String indent) {
    var position = spot.position();
    return String.format(
        Locale.ROOT,
        """
        %1$sworld: %2$s
        %1$sx: %3$.2f
        %1$sy: %4$.2f
        %1$sz: %5$.2f
        %1$syaw: %6$.1f
        %1$spitch: %7$.1f\
        """,
        indent,
        spot.world(),
        position.x(),
        position.y(),
        position.z(),
        spot.rotation().yaw(),
        spot.rotation().pitch());
  }
}
