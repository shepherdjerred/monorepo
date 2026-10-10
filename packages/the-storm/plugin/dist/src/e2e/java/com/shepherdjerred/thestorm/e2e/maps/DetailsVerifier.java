package com.shepherdjerred.thestorm.e2e.maps;

import com.shepherdjerred.thestorm.rwf.adapter.content.details.MapDetails;
import com.shepherdjerred.thestorm.rwf.domain.geometry.BlockPos;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import org.bukkit.World;
import org.bukkit.block.BlockState;
import org.bukkit.block.Container;
import org.bukkit.inventory.ItemStack;

/** Compares native item values, including amounts and metadata, rather than opaque NBT encoding. */
final class DetailsVerifier {
  private DetailsVerifier() {}

  static void verify(World world, BlockPos origin, MapDetails expected) {
    for (var entry : expected.containers()) {
      var state = state(world, origin, entry.at(), entry.material());
      if (!(state instanceof Container container))
        throw new IllegalStateException("expected container at " + entry.at());
      var actual = container.getSnapshotInventory().getContents();
      var items = ItemStack.deserializeItemsFromBytes(Base64.getDecoder().decode(entry.items()));
      if (actual.length != items.length)
        throw new IllegalStateException("inventory size differs at " + entry.at());
      for (int slot = 0; slot < items.length; slot++) {
        if (!equal(actual[slot], items[slot]))
          throw new IllegalStateException(
              "inventory item or metadata differs at " + entry.at() + " slot " + slot);
      }
    }
    for (var entry : expected.signs()) {
      var signs = new ArrayList<MapDetails.Sign>();
      DetailsCapture.capture(
          state(world, origin, entry.at(), entry.material()), origin, new ArrayList<>(), signs);
      if (!signs.equals(List.of(entry)))
        throw new IllegalStateException("sign text or style differs at " + entry.at());
    }
  }

  private static boolean equal(ItemStack actual, ItemStack expected) {
    boolean actualEmpty = actual == null || actual.getType().isAir();
    boolean expectedEmpty = expected == null || expected.getType().isAir();
    return (actualEmpty || expectedEmpty) ? actualEmpty == expectedEmpty : actual.equals(expected);
  }

  private static BlockState state(World world, BlockPos origin, BlockPos at, String material) {
    var state =
        world.getBlockAt(origin.x() + at.x(), origin.y() + at.y(), origin.z() + at.z()).getState();
    if (!state.getType().getKey().toString().equals(material))
      throw new IllegalStateException("payload block differs at " + at);
    return state;
  }
}
