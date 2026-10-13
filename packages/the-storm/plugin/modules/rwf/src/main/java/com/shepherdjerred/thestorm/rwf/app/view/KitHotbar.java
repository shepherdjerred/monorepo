package com.shepherdjerred.thestorm.rwf.app.view;

import com.shepherdjerred.thestorm.rwf.domain.kit.KitBook;
import com.shepherdjerred.thestorm.rwf.domain.kit.KitSpec;
import java.util.List;
import java.util.Optional;

/**
 * Where a kit's items sit on the hotbar, for modules that drive a kit's holder: the Bomb Fuse in
 * slot 0, then the kit's items in its order. Only hotbar slots (0 to 8) are listed.
 *
 * @param kit the kit id
 * @param slots each item and its slot, in slot order
 */
public record KitHotbar(String kit, List<Slot> slots) {

  /**
   * One hotbar item.
   *
   * @param slot its slot, 1 to 8
   * @param material its material, as {@code IRON_SWORD}
   */
  public record Slot(int slot, String material) {}

  public KitHotbar {
    slots = List.copyOf(slots);
  }

  /** The hotbar of kit {@code id}, if rwf has it. */
  public static Optional<KitHotbar> of(String id) {
    return KitBook.byId(id)
        .map(
            spec ->
                new KitHotbar(
                    id,
                    spec.layout().stream()
                        .filter(placement -> placement.slot() > 0 && placement.slot() <= 8)
                        .map(KitHotbar::slot)
                        .toList()));
  }

  private static Slot slot(KitSpec.Placement placement) {
    return new Slot(placement.slot(), placement.item().material());
  }
}
