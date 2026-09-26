package com.shepherdjerred.thestorm.mobs.adapter.paper;

import com.shepherdjerred.thestorm.core.protection.Decision;
import com.shepherdjerred.thestorm.core.protection.ProtectedAction;
import com.shepherdjerred.thestorm.core.protection.Protection;
import com.shepherdjerred.thestorm.mobs.domain.config.AdminRegions;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import net.kyori.adventure.text.logger.slf4j.ComponentLogger;
import org.bukkit.Location;
import org.bukkit.Server;
import org.jspecify.annotations.Nullable;

/**
 * Whether a location lies in an admin region, found through land protection from one configured
 * point inside each region. Main thread only.
 */
final class AdminRegionIndex {

  /** Nobody: a player who owns nothing and belongs to no town. */
  private static final UUID NOBODY = new UUID(0, 0);

  private final List<Location> anchors;
  private final @Nullable Protection protection;
  private final ComponentLogger logger;
  private final Set<Location> warned = new HashSet<>();

  private AdminRegionIndex(
      List<Location> anchors, @Nullable Protection protection, ComponentLogger logger) {
    this.anchors = List.copyOf(anchors);
    this.protection = protection;
    this.logger = logger;
  }

  /** No admin regions. */
  static AdminRegionIndex none(ComponentLogger logger) {
    return new AdminRegionIndex(List.of(), null, logger);
  }

  /** The configured anchors; throws if one names a world that is not loaded. */
  static AdminRegionIndex of(
      Server server, AdminRegions regions, Protection protection, ComponentLogger logger) {
    var anchors = new ArrayList<Location>();
    for (var anchor : regions.anchors()) {
      var world = server.getWorld(anchor.world());
      if (world == null) {
        throw new IllegalStateException(
            "mobs.yml adminRegions names world '" + anchor.world() + "', which is not loaded");
      }
      anchors.add(new Location(world, anchor.x(), anchor.y(), anchor.z()));
    }
    return new AdminRegionIndex(anchors, protection, logger);
  }

  /** Whether {@code location} is in one of the admin regions. */
  boolean contains(Location location) {
    if (protection == null) {
      return false;
    }
    for (var anchor : anchors) {
      if (Objects.equals(anchor.getWorld(), location.getWorld())
          && protection.sameLand(anchor, location)
          && isProtected(protection, anchor)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Whether the anchor lies on protected land. An anchor in the wilderness would share its land
   * with the whole wilderness, so it is ignored and reported once.
   */
  private boolean isProtected(Protection protection, Location anchor) {
    if (protection.check(NOBODY, ProtectedAction.BUILD, anchor) instanceof Decision.Denied) {
      return true;
    }
    if (warned.add(anchor)) {
      logger.warn(
          "mobs.yml admin region anchor {} {} {} {} is not on protected land; ignoring it",
          anchor.getWorld().getName(),
          anchor.getBlockX(),
          anchor.getBlockY(),
          anchor.getBlockZ());
    }
    return false;
  }
}
