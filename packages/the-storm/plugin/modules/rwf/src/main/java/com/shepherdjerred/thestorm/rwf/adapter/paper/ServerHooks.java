package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.core.world.ChunkTickets;
import java.util.function.BiPredicate;
import java.util.function.Consumer;
import org.bukkit.entity.Display;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;
import org.bukkit.entity.TextDisplay;

/**
 * The server operations tests replace, because MockBukkit does not implement them: chunk tickets,
 * the hologram's billboard mode, line-of-sight ray casts and the hurt animation.
 *
 * @param chunks keeps map chunks loaded
 * @param hologramStyle styles a bomb hologram once spawned
 * @param lineOfSight whether the first entity can see the second
 * @param hurt shows a player the red flash of being hit
 */
public record ServerHooks(
    ChunkHolder chunks,
    Consumer<TextDisplay> hologramStyle,
    BiPredicate<LivingEntity, LivingEntity> lineOfSight,
    Consumer<Player> hurt) {

  /** The real server: shared chunk tickets, holograms facing the viewer, real ray casts. */
  public static ServerHooks production(ChunkTickets tickets) {
    return new ServerHooks(
        ChunkHolder.shared(tickets),
        display -> display.setBillboard(Display.Billboard.CENTER),
        LivingEntity::hasLineOfSight,
        player -> player.sendHurtAnimation(0));
  }
}
