package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.rwf.domain.ability.AbilityInput;
import com.shepherdjerred.thestorm.rwf.domain.ability.Placed;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Bannerman;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Grappler;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Sacrificial;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Spotter;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.geometry.BlockPos;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.bukkit.Material;
import org.bukkit.Tag;
import org.bukkit.block.Block;
import org.bukkit.block.BlockFace;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.Action;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.player.PlayerFishEvent;
import org.bukkit.event.player.PlayerInteractEntityEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.inventory.ItemStack;

/**
 * What players do with the Batch D and new kits in a live match, turned into ability inputs: a
 * Sacrificial's magic, a Spotter's spyglass, a Grappler's hook, a Bannerman's banner and the
 * enemy's strikes on it. (Shears, bricks and the Decoy's armor stand are {@link KitListener}'s
 * right-click uses.) The server's own handling of these clicks and placements is cancelled; the
 * rules decide. Main thread only.
 */
final class KitWorldListener implements Listener {

  private final MatchRunner runner;
  private final PaperContext context;
  private final Keys keys;
  private final ServerHooks hooks;

  KitWorldListener(MatchRunner runner, PaperContext context, Keys keys, ServerHooks hooks) {
    this.runner = runner;
    this.context = context;
    this.keys = keys;
    this.hooks = hooks;
  }

  private Optional<String> kit(Player player) {
    if (!player.getWorld().equals(context.mapWorld()) || !runner.fighting(player.getUniqueId())) {
      return Optional.empty();
    }
    return runner.memberOf(player.getUniqueId()).flatMap(member -> member.kit());
  }

  private boolean holding(ItemStack item, Material material) {
    return item.getType() == material && keys.isKitItem(item);
  }

  @EventHandler(priority = EventPriority.HIGHEST)
  void onInteract(PlayerInteractEvent event) {
    var player = event.getPlayer();
    var kit = kit(player);
    if (kit.isEmpty() || event.getHand() == EquipmentSlot.OFF_HAND) {
      return;
    }
    var block = event.getClickedBlock();
    if (event.getAction() == Action.LEFT_CLICK_BLOCK && block != null) {
      strike(player, Places.pos(block));
      return;
    }
    var item = event.getItem();
    if (item != null && event.getAction().isRightClick()) {
      use(event, kit.orElseThrow(), item);
    }
  }

  /** {@code player} strikes {@code pos}: a planted banner takes the blow. */
  private void strike(Player player, BlockPos pos) {
    if (runner
        .match()
        .abilities()
        .placedAt(pos)
        .filter(Placed.Banner.class::isInstance)
        .isPresent()) {
      runner.kits().act(player, new AbilityInput.StrikeBanner(pos));
    }
  }

  /**
   * A Spotter looks through its glass. The server's zoom is kept: the other kits' clicks are in
   * {@link KitListener}, which denies the vanilla use.
   */
  private void use(PlayerInteractEvent event, String kit, ItemStack item) {
    if (kit.equals(Spotter.ID) && holding(item, Material.SPYGLASS)) {
      runner.kits().act(event.getPlayer(), new AbilityInput.Spot(seen(event.getPlayer())));
    }
  }

  /** The living enemies {@code spotter} can see within range, in front of them. */
  List<CombatantId> seen(Player spotter) {
    var self = runner.memberOf(spotter.getUniqueId()).orElseThrow();
    var eye = spotter.getEyeLocation();
    var look = eye.getDirection();
    var seen = new ArrayList<CombatantId>();
    for (var member : runner.match().members()) {
      if (!member.alive() || member.team().equals(self.team())) {
        continue;
      }
      runner
          .entity(member.id())
          .ifPresent(
              enemy -> {
                var toward = enemy.getEyeLocation().toVector().subtract(eye.toVector());
                if (toward.length() <= Spotter.RANGE
                    && toward.length() > 0
                    && Math.toDegrees(toward.angle(look)) <= 60
                    && hooks.lineOfSight().test(spotter, enemy)) {
                  seen.add(member.id());
                }
              });
    }
    return seen;
  }

  /**
   * An Engineer's 3-wide, 2-high wall on {@code clicked}'s {@code face}, across where {@code
   * player} looks: only the blocks that are air now.
   */
  static List<BlockPos> wall(Player player, Block clicked, BlockFace face) {
    var base = clicked.getRelative(face);
    var look = Places.at(player).getDirection();
    var alongZ = Math.abs(look.getX()) >= Math.abs(look.getZ());
    var wall = new ArrayList<BlockPos>();
    for (var offset = -1; offset <= 1; offset++) {
      for (var up = 0; up <= 1; up++) {
        var block = alongZ ? base.getRelative(0, up, offset) : base.getRelative(offset, up, 0);
        if (block.getType().isAir()) {
          wall.add(Places.pos(block));
        }
      }
    }
    return wall;
  }

  /** A Sacrificial casts sacrifice on the ally it clicks with its magic. */
  @EventHandler(priority = EventPriority.HIGHEST)
  void onInteractEntity(PlayerInteractEntityEvent event) {
    var player = event.getPlayer();
    if (event.getHand() == EquipmentSlot.OFF_HAND
        || kit(player).filter(Sacrificial.ID::equals).isEmpty()
        || !holding(player.getInventory().getItemInMainHand(), Material.RED_DYE)) {
      return;
    }
    runner
        .memberOf(event.getRightClicked().getUniqueId())
        .ifPresent(ally -> runner.kits().act(player, new AbilityInput.Bond(ally.id())));
  }

  /** A Grappler reels in: it is pulled toward the hook. */
  @EventHandler(priority = EventPriority.HIGH)
  void onFish(PlayerFishEvent event) {
    var player = event.getPlayer();
    if (kit(player).filter(Grappler.ID::equals).isEmpty()) {
      return;
    }
    var state = event.getState();
    if (state == PlayerFishEvent.State.REEL_IN
        || state == PlayerFishEvent.State.IN_GROUND
        || state == PlayerFishEvent.State.CAUGHT_ENTITY) {
      runner
          .kits()
          .act(player, new AbilityInput.Grapple(Places.vec(event.getHook().getLocation())));
    }
  }

  /** A Bannerman plants its banner: the server's placement is replaced by the rules'. */
  @EventHandler(priority = EventPriority.HIGHEST)
  void onPlace(BlockPlaceEvent event) {
    var player = event.getPlayer();
    if (kit(player).filter(Bannerman.ID::equals).isEmpty()
        || !Tag.BANNERS.isTagged(event.getItemInHand().getType())) {
      return;
    }
    event.setCancelled(true);
    if (!event.getBlockReplacedState().getType().isAir()) {
      Texts.error(player, "Must place in a valid location!");
      return;
    }
    var _ = event.getBlockReplacedState().update(true, false);
    runner.kits().act(player, new AbilityInput.PlantBanner(Places.pos(event.getBlockPlaced())));
  }
}
