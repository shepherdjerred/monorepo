package com.shepherdjerred.thestorm.towns.adapter.paper;

import com.shepherdjerred.thestorm.towns.domain.land.Land;
import com.shepherdjerred.thestorm.towns.domain.protection.Act;
import com.shepherdjerred.thestorm.towns.domain.protection.Action;
import com.shepherdjerred.thestorm.towns.domain.protection.Actor;
import com.shepherdjerred.thestorm.towns.domain.protection.Subject;
import com.shepherdjerred.thestorm.towns.domain.world.WorldEffect;
import java.util.List;
import java.util.Optional;
import org.bukkit.block.Block;
import org.bukkit.entity.AbstractWindCharge;
import org.bukkit.entity.Entity;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockBurnEvent;
import org.bukkit.event.block.BlockExplodeEvent;
import org.bukkit.event.block.BlockIgniteEvent;
import org.bukkit.event.block.TNTPrimeEvent;
import org.bukkit.event.entity.EntityExplodeEvent;
import org.jspecify.annotations.Nullable;

/**
 * Fire and explosions: lighting fires, fire spreading and burning, priming TNT, and filtering the
 * blocks every explosion (TNT, creepers, crystals, beds, anchors, withers, fireballs, wind charges)
 * would change.
 */
final class FireListener implements Listener {

  private static final Act BUILD = new Act(Action.BUILD, Subject.BLOCK);
  private static final Act TRIGGER = new Act(Action.INTERACT, Subject.BLOCK);

  private final Guard guard;
  private final BlockKinds kinds;

  FireListener(Guard guard, BlockKinds kinds) {
    this.guard = guard;
    this.kinds = kinds;
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onIgnite(BlockIgniteEvent event) {
    var block = event.getBlock();
    var igniter = event.getIgnitingEntity();
    var player =
        Optional.ofNullable(event.getPlayer()).map(Culprit::of).or(() -> guard.culprit(igniter));
    if (player.isPresent()) {
      event.setCancelled(!guard.permits(player.get(), BUILD, guard.land(block)));
      return;
    }
    var effect =
        event.getCause() == BlockIgniteEvent.IgniteCause.EXPLOSION
            ? WorldEffect.EXPLOSION
            : WorldEffect.FIRE_SPREAD;
    var from = origin(event.getIgnitingBlock(), igniter, block);
    if (!Guard.flows(effect, from, guard.land(block))) {
      event.setCancelled(true);
    }
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onBurn(BlockBurnEvent event) {
    var block = event.getBlock();
    var from = origin(event.getIgnitingBlock(), null, block);
    if (!Guard.flows(WorldEffect.FIRE_BURN, from, guard.land(block))) {
      event.setCancelled(true);
    }
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onPrime(TNTPrimeEvent event) {
    var tnt = event.getBlock();
    var primer = event.getPrimingEntity();
    var player = guard.culprit(primer);
    if (player.isPresent()) {
      event.setCancelled(!guard.permits(player.get(), BUILD, guard.land(tnt)));
      return;
    }
    var from = origin(event.getPrimingBlock(), primer, tnt);
    if (!Guard.flows(WorldEffect.EXPLOSION, from, guard.land(tnt))) {
      event.setCancelled(true);
    }
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onEntityExplode(EntityExplodeEvent event) {
    var entity = event.getEntity();
    var from = guard.land(event.getLocation());
    var player = guard.culprit(entity);
    if (entity instanceof AbstractWindCharge && player.isPresent()) {
      // A player's wind charge only toggles doors, buttons and levers: each is their own use.
      var actor = player.get().actor();
      event.blockList().removeIf(block -> !mayTrigger(actor, block));
      return;
    }
    filter(event.blockList(), from, player);
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onBlockExplode(BlockExplodeEvent event) {
    filter(event.blockList(), guard.land(event.getBlock()), Optional.empty());
  }

  /**
   * Keeps only blocks the explosion may change: within its own land, where that land allows
   * explosions, and, for an explosion a player caused, where that player may build.
   */
  private void filter(List<Block> blocks, Land from, Optional<Culprit> player) {
    // One actor for the whole blast: its bypass check is a permission lookup.
    var actor = player.map(Culprit::actor).orElse(null);
    blocks.removeIf(
        block -> {
          var land = guard.land(block);
          return !Guard.flows(WorldEffect.EXPLOSION, from, land)
              || (actor != null && !guard.permitsQuietly(actor, BUILD, land));
        });
  }

  private boolean mayTrigger(Actor player, Block block) {
    var act = kinds.use(block.getType()).orElse(TRIGGER);
    return guard.permitsQuietly(player, act, guard.land(block));
  }

  /** The land an effect starts on: its source block, else its source entity, else the target. */
  private Land origin(@Nullable Block block, @Nullable Entity entity, Block target) {
    if (block != null) {
      return guard.land(block);
    }
    if (entity != null) {
      return guard.land(Origins.of(entity));
    }
    return guard.land(target);
  }
}
