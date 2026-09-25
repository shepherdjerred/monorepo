package com.shepherdjerred.thestorm.mechanics.adapter.paper;

import com.shepherdjerred.thestorm.core.protection.ProtectedAction;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Pos;
import com.shepherdjerred.thestorm.mechanics.domain.grid.SignView;
import com.shepherdjerred.thestorm.mechanics.domain.sign.Feature;
import com.shepherdjerred.thestorm.mechanics.domain.tools.Cycle;
import com.shepherdjerred.thestorm.mechanics.domain.tools.MapRange;
import java.util.List;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.entity.ItemFrame;
import org.bukkit.entity.Player;
import org.bukkit.inventory.meta.MapMeta;

/**
 * Map changers: each right-click moves the maps in item frames beside the sign to the next id in
 * the sign's range (sneak to go back). The frame keeps its one map item; only which map it shows
 * changes.
 */
final class MapChangers {

  /** How far from the sign's centre a frame may hang. */
  private static final double REACH = 1.5;

  private final Kit kit;

  MapChangers(Kit kit) {
    this.kit = kit;
  }

  void click(Player player, PaperGrid grid, Pos sign, SignView view) {
    switch (MapRange.parse(view.line(MapRange.LINE), kit.config().mapChanger().maxRange())) {
      case Result.Err<MapRange, String>(var message) ->
          Replies.error(player, Feature.MAP_CHANGER, message);
      case Result.Ok<MapRange, String>(var range) -> cycle(player, grid.location(sign), range);
    }
  }

  private void cycle(Player player, Location signCorner, MapRange range) {
    var ids = range.ids().stream().filter(id -> player.getServer().getMap(id) != null).toList();
    var center = signCorner.add(0.5, 0.5, 0.5);
    var changed = 0;
    for (var frame : center.getNearbyEntitiesByType(ItemFrame.class, REACH)) {
      if (changeFrame(player, frame, ids)) {
        changed++;
      }
    }
    if (changed == 0) {
      Replies.error(
          player, Feature.MAP_CHANGER, "No item frame with a map you may change beside this sign.");
    }
  }

  private boolean changeFrame(Player player, ItemFrame frame, List<Integer> ids) {
    var item = frame.getItem();
    if (item.getType() != Material.FILLED_MAP
        || !(item.getItemMeta() instanceof MapMeta meta)
        || !kit.guard()
            .check(
                player.getUniqueId(),
                ProtectedAction.INTERACT_ENTITY,
                new PaperGrid(frame.getWorld()),
                PaperGrid.pos(frame.getLocation()))
            .isAllowed()) {
      return false;
    }
    var shown = meta.getMapView();
    var current = shown != null ? shown.getId() : -1;
    var next = Cycle.step(ids, current, !player.isSneaking());
    if (next.isEmpty()) {
      return false;
    }
    var map = player.getServer().getMap(next.orElseThrow());
    if (map == null) {
      return false;
    }
    meta.setMapView(map);
    item.setItemMeta(meta);
    frame.setItem(item, false);
    return true;
  }
}
