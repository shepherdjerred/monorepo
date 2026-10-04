// Ported from libraryaddict's Red Warfare
// (redwarfare-build/src/me/libraryaddict/build/customdata/SearchAndDestroyCustomData.java);
// see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.map;

import com.shepherdjerred.thestorm.rwf.domain.geometry.BlockPos;
import java.util.regex.Pattern;

/**
 * A TNT block on the map that is a bomb.
 *
 * @param id a stable id, unique within the map, such as {@code red-1} or {@code nuke-1}
 * @param owner the team it belongs to, or a nuke
 * @param position the TNT block
 */
public record BombSite(String id, BombOwner owner, BlockPos position) {

  private static final Pattern ID = Pattern.compile("[a-z0-9][a-z0-9-]*");

  public BombSite {
    if (!ID.matcher(id).matches()) {
      throw new IllegalArgumentException("bomb id must be lower-case kebab-case: " + id);
    }
  }
}
