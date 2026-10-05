package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.core.world.ChunkTickets;
import java.util.function.BiPredicate;
import java.util.function.Consumer;
import org.bukkit.entity.Display;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;

/**
 * The server operations tests replace, because MockBukkit does not implement them: chunk tickets,
 * display entities' billboard mode, line-of-sight ray casts and the hurt animation.
 *
 * @param chunks keeps map chunks loaded
 * @param displayStyle styles a display entity (a bomb hologram, the lobby's texts and kit items)
 *     once spawned
 * @param lineOfSight whether the first entity can see the second
 * @param hurt shows a player the red flash of being hit
 */
public record ServerHooks(
    ChunkHolder chunks,
    Consumer<Display> displayStyle,
    BiPredicate<LivingEntity, LivingEntity> lineOfSight,
    Consumer<Player> hurt) {

  /** The real server: shared chunk tickets, displays facing the viewer, real ray casts. */
  public static ServerHooks production(ChunkTickets tickets) {
    return new ServerHooks(
        ChunkHolder.shared(tickets),
        display -> display.setBillboard(Display.Billboard.CENTER),
        LivingEntity::hasLineOfSight,
        player -> player.sendHurtAnimation(0));
  }
}
