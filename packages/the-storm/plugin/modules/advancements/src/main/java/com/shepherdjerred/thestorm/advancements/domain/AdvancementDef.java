package com.shepherdjerred.thestorm.advancements.domain;

import org.jspecify.annotations.Nullable;

/**
 * One advancement in the {@code thestorm} datapack.
 *
 * @param path the key under {@code thestorm:}, such as {@code a_survival/home}
 * @param parent the parent path, or null for a tab root
 * @param title the literal title
 * @param description the literal description
 * @param icon a vanilla item id
 * @param background a vanilla block texture, only on a root
 * @param root whether this advancement is a tab
 */
public record AdvancementDef(
    String path,
    @Nullable String parent,
    String title,
    String description,
    String icon,
    @Nullable String background,
    boolean root) {

  public AdvancementDef {
    if (path.isBlank() || path.startsWith("minecraft:")) {
      throw new IllegalArgumentException("advancement path: " + path);
    }
    if (root != (parent == null) || root != (background != null)) {
      throw new IllegalArgumentException(
          "a root is a tab with a background and no parent: " + path);
    }
  }

  /** The first path segment, which is the tab. */
  public String tab() {
    var slash = path.indexOf('/');
    return slash < 0 ? path : path.substring(0, slash);
  }
}
