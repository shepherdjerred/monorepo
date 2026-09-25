package com.shepherdjerred.thestorm.shops.domain.shop;

/**
 * Identifies exactly which item a shop trades: the material plus the item's full serialized form
 * (enchantments, custom name, damage and every other component), with the amount set to one. Two
 * items trade as the same only when the adapter finds them similar to the decoded template; display
 * text never decides it.
 *
 * @param material the material key, such as {@code DIAMOND_SWORD}
 * @param template the one-item stack, serialized and Base64-encoded
 * @param special whether the item differs from a plain stack of its material
 */
public record ItemFingerprint(String material, String template, boolean special) {

  public ItemFingerprint {
    if (material.isBlank() || template.isBlank()) {
      throw new IllegalArgumentException("a fingerprint needs a material and a template");
    }
  }
}
