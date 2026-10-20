package com.shepherdjerred.thestorm.creative.adapter.paper;

import com.shepherdjerred.thestorm.core.snapshot.ItemData;
import com.shepherdjerred.thestorm.core.snapshot.PlayerStates;
import com.shepherdjerred.thestorm.creative.app.VisitBody;
import com.shepherdjerred.thestorm.creative.domain.BodyRole;
import com.shepherdjerred.thestorm.creative.domain.PlotGrid;
import java.time.Instant;
import java.util.Arrays;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.Server;
import org.bukkit.World;
import org.bukkit.entity.Player;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;

/** Captures and applies a visit body, including the ender chest the shared snapshot omits. */
public final class CreativeBodies {

  private CreativeBodies() {}

  /** Feet on the glowstone crossing at the recovered spawn. */
  public static Location spawn(World world) {
    return new Location(world, PlotGrid.SPAWN_X + 0.5, PlotGrid.SPAWN_Y, PlotGrid.SPAWN_Z + 0.5);
  }

  /** {@code player} right now, including the ender chest. The cursor must already be settled. */
  public static VisitBody capture(Player player, BodyRole role, Instant now) {
    return new VisitBody(
        role,
        PlayerStates.capture(player, role.wire(), now),
        ItemData.of(ItemStack.serializeItemsAsBytes(contents(player.getEnderChest()))));
  }

  /**
   * Puts {@code body} back, including the ender chest. Returns false, having restored everything
   * but the position, when the body's world is gone.
   */
  public static boolean apply(Player player, VisitBody body, Server server) {
    var placed = PlayerStates.apply(player, body.snapshot(), server);
    var ender = player.getEnderChest();
    ender.clear();
    ender.setContents(ItemStack.deserializeItemsFromBytes(body.enderChest().bytes()));
    return placed;
  }

  /** Empties the player into a fresh creative visit: no items, no ender chest, creative flight. */
  public static void openFresh(Player player) {
    PlayerStates.wipe(player, GameMode.CREATIVE);
    player.getEnderChest().clear();
    player.setAllowFlight(true);
    player.setFlying(true);
    player.setFlySpeed(0.1f);
  }

  private static ItemStack[] contents(Inventory inventory) {
    return Arrays.stream(inventory.getContents())
        .map(item -> item == null ? ItemStack.empty() : item)
        .toArray(ItemStack[]::new);
  }
}
