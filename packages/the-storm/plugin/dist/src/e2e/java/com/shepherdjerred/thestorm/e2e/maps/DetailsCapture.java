package com.shepherdjerred.thestorm.e2e.maps;

import com.shepherdjerred.thestorm.rwf.adapter.content.details.MapDetails;
import com.shepherdjerred.thestorm.rwf.domain.geometry.BlockPos;
import java.util.Base64;
import java.util.List;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.block.BlockState;
import org.bukkit.block.Container;
import org.bukkit.block.Sign;
import org.bukkit.block.sign.Side;
import org.bukkit.block.sign.SignSide;
import org.bukkit.inventory.ItemStack;

/** Private test/export boundary for the payloads that the production restorer admits. */
final class DetailsCapture {
  private DetailsCapture() {}

  static void capture(
      BlockState state,
      BlockPos origin,
      List<MapDetails.Container> containers,
      List<MapDetails.Sign> signs) {
    var at =
        new BlockPos(
            state.getX() - origin.x(), state.getY() - origin.y(), state.getZ() - origin.z());
    var material = state.getType().getKey().toString();
    if (state instanceof Container container) {
      var items = ItemStack.serializeItemsAsBytes(container.getSnapshotInventory().getContents());
      containers.add(
          new MapDetails.Container(at, material, Base64.getEncoder().encodeToString(items)));
    } else if (state instanceof Sign sign) {
      signs.add(
          new MapDetails.Sign(
              at,
              material,
              face(sign.getSide(Side.FRONT)),
              face(sign.getSide(Side.BACK)),
              sign.isWaxed()));
    }
  }

  private static MapDetails.Face face(SignSide side) {
    return new MapDetails.Face(
        side.lines().stream().map(PlainTextComponentSerializer.plainText()::serialize).toList(),
        side.getColor().name(),
        side.isGlowingText());
  }
}
