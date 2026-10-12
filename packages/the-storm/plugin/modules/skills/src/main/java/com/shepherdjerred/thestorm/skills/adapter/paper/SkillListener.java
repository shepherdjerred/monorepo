package com.shepherdjerred.thestorm.skills.adapter.paper;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.world.SealedWorlds;
import com.shepherdjerred.thestorm.skills.app.BlockMove;
import com.shepherdjerred.thestorm.skills.app.BlockPosition;
import com.shepherdjerred.thestorm.skills.app.SkillLevels;
import com.shepherdjerred.thestorm.skills.app.SkillProgress;
import com.shepherdjerred.thestorm.skills.domain.RepairRules;
import com.shepherdjerred.thestorm.skills.domain.Skill;
import com.shepherdjerred.thestorm.skills.domain.SkillPerks;
import com.shepherdjerred.thestorm.skills.domain.SkillsConfig;
import java.time.Instant;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.WeakHashMap;
import java.util.concurrent.CompletableFuture;
import net.kyori.adventure.text.Component;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.Tag;
import org.bukkit.TreeType;
import org.bukkit.block.Block;
import org.bukkit.block.BlockFace;
import org.bukkit.block.BlockState;
import org.bukkit.block.data.Bisected;
import org.bukkit.entity.Enderman;
import org.bukkit.entity.FallingBlock;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Mob;
import org.bukkit.entity.Player;
import org.bukkit.entity.Projectile;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.Action;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockFertilizeEvent;
import org.bukkit.event.block.BlockMultiPlaceEvent;
import org.bukkit.event.block.BlockPistonExtendEvent;
import org.bukkit.event.block.BlockPistonRetractEvent;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.entity.EntityChangeBlockEvent;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.event.entity.EntityDeathEvent;
import org.bukkit.event.entity.EntityRemoveEvent;
import org.bukkit.event.player.PlayerFishEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.event.player.PlayerItemMendEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.event.world.StructureGrowEvent;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.Damageable;
import org.bukkit.persistence.PersistentDataType;

/** Awards earned experience and applies the Acrobatics fall-damage perk. */
final class SkillListener implements Listener {

  private static final Set<String> FARMED_SPAWNS =
      Set.of("SPAWNER", "TRIAL_SPAWNER", "SPAWNER_EGG", "DISPENSE_EGG", "COMMAND", "CUSTOM");
  private static final Set<String> SCRIPTED_MOBS =
      Set.of("thestorm:quest_spawned", "thestorm:arena_entity");

  private final ModuleContext context;
  private final SkillLevels levels;
  private final SkillsConfig config;
  private final SealedWorlds sealed;
  private final NamespacedKey fallingOriginKey;
  private final Map<UUID, SkillProgress> online = new HashMap<>();
  private final Map<UUID, Instant> lastAcrobatics = new HashMap<>();
  private final Map<LivingEntity, Hit> lastHits = new WeakHashMap<>();

  private record Hit(UUID playerId, Skill skill) {}

  SkillListener(
      ModuleContext context, SkillLevels levels, SkillsConfig config, SealedWorlds sealed) {
    this.context = context;
    this.levels = levels;
    this.config = config;
    this.sealed = sealed;
    this.fallingOriginKey = new NamespacedKey(context.plugin(), "skills_falling_origin");
  }

  @EventHandler
  void onJoin(PlayerJoinEvent event) {
    if (!com.shepherdjerred.thestorm.core.players.Humans.isHuman(event.getPlayer())) return;
    var player = event.getPlayer();
    var _ =
        levels
            .progress(player.getUniqueId())
            .whenCompleteAsync(
                (progress, failure) -> {
                  if (failure != null) {
                    context
                        .logger()
                        .error("Could not load skills for {}", player.getName(), failure);
                  } else if (player.isOnline()) {
                    online.merge(player.getUniqueId(), progress, SkillListener::newerProgress);
                  }
                },
                context.scheduler().mainThread());
  }

  @EventHandler
  void onQuit(PlayerQuitEvent event) {
    if (!com.shepherdjerred.thestorm.core.players.Humans.isHuman(event.getPlayer())) return;
    var id = event.getPlayer().getUniqueId();
    online.remove(id);
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void onPlace(BlockPlaceEvent event) {
    var blocks = new ArrayList<Block>();
    blocks.add(event.getBlockPlaced());
    if (event instanceof BlockMultiPlaceEvent multiPlace) {
      multiPlace.getReplacedBlockStates().stream().map(BlockState::getBlock).forEach(blocks::add);
    }
    blocks.stream()
        .distinct()
        .filter(SkillListener::shouldTrackPlacement)
        .forEach(this::markPlaced);
  }

  private static boolean shouldTrackPlacement(Block block) {
    // Newly planted crops and saplings are immature now but can later earn XP.
    return SkillActivities.block(block).isPresent()
        || SkillActivities.isCrop(block.getType())
        || SkillActivities.isTreeStarter(block.getType());
  }

  private void markPlaced(Block block) {
    var _ =
        levels
            .markPlaced(position(block))
            .whenComplete(
                (_, failure) -> {
                  if (failure != null) {
                    context.logger().error("Could not mark placed skill block", failure);
                  }
                });
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void onFertilize(BlockFertilizeEvent event) {
    event.getBlocks().stream()
        .filter(state -> SkillActivities.isFertilizedTrackable(state.getType()))
        .map(BlockState::getBlock)
        .distinct()
        .forEach(this::markPlaced);
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void onTreeGrow(StructureGrowEvent event) {
    var source = event.getLocation().getBlock();
    if (!SkillActivities.isTreeStarter(source.getType())) {
      return;
    }
    var saplings = treeSaplings(source, event.getSpecies());
    var generated =
        event.getBlocks().stream()
            .filter(state -> SkillActivities.isGeneratedHarvestable(state.getType()))
            .map(BlockState::getBlock)
            .map(SkillListener::position)
            .distinct()
            .toList();
    var _ =
        levels
            .growPlacedTree(saplings, generated)
            .whenComplete(
                (_, failure) -> {
                  if (failure != null) {
                    context.logger().error("Could not track generated tree blocks", failure);
                  }
                });
  }

  private static List<BlockPosition> treeSaplings(Block source, TreeType species) {
    // Only these tree variants consume a 2x2 square. Four adjacent oak or birch
    // saplings still grow independently, so their other markers must survive.
    if (species != TreeType.DARK_OAK
        && species != TreeType.JUNGLE
        && species != TreeType.MEGA_REDWOOD
        && species != TreeType.MEGA_PINE
        && species != TreeType.PALE_OAK
        && species != TreeType.PALE_OAK_CREAKING) {
      return List.of(position(source));
    }
    for (int dx = -1; dx <= 0; dx++) {
      for (int dz = -1; dz <= 0; dz++) {
        var square =
            List.of(
                source.getRelative(dx, 0, dz),
                source.getRelative(dx + 1, 0, dz),
                source.getRelative(dx, 0, dz + 1),
                source.getRelative(dx + 1, 0, dz + 1));
        if (square.stream().allMatch(block -> block.getType() == source.getType())) {
          return square.stream().map(SkillListener::position).toList();
        }
      }
    }
    return List.of(position(source));
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void onPistonExtend(BlockPistonExtendEvent event) {
    movePistonBlocks(event.getBlocks(), event.getDirection());
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void onPistonRetract(BlockPistonRetractEvent event) {
    movePistonBlocks(event.getBlocks(), event.getDirection().getOppositeFace());
  }

  private void movePistonBlocks(List<Block> blocks, BlockFace direction) {
    var moves = new ArrayList<BlockMove>();
    for (var block : blocks) {
      moves.add(new BlockMove(position(block), position(block.getRelative(direction))));
    }
    if (!moves.isEmpty()) {
      var _ = levels.movePlaced(moves).whenComplete((_, failure) -> logMoveFailure(failure));
    }
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void onFallingBlockChange(EntityChangeBlockEvent event) {
    if (event.getEntity() instanceof Enderman enderman) {
      moveEndermanBlock(event, enderman);
      return;
    }
    if (!(event.getEntity() instanceof FallingBlock falling)) {
      return;
    }
    var data = falling.getPersistentDataContainer();
    if (event.getTo().isAir()) {
      var from = position(event.getBlock());
      data.set(
          fallingOriginKey,
          PersistentDataType.STRING,
          from.world() + "," + from.x() + "," + from.y() + "," + from.z());
      var _ =
          levels
              .launchFalling(from, falling.getUniqueId())
              .whenComplete((_, failure) -> logMoveFailure(failure));
      return;
    }
    var encoded = data.get(fallingOriginKey, PersistentDataType.STRING);
    var destination = position(event.getBlock());
    if (encoded == null) {
      // An entity created outside this listener has no trustworthy source position.
      var _ = levels.markPlaced(destination).whenComplete((_, failure) -> logMoveFailure(failure));
      return;
    }
    data.remove(fallingOriginKey);
    var _ =
        levels
            .landFalling(falling.getUniqueId(), destination)
            .whenComplete((_, failure) -> logMoveFailure(failure));
  }

  private void moveEndermanBlock(EntityChangeBlockEvent event, Enderman enderman) {
    var id = enderman.getUniqueId();
    var destination = position(event.getBlock());
    if (event.getTo().isAir()) {
      var _ =
          levels
              .launchFalling(destination, id)
              .whenComplete((_, failure) -> logMoveFailure(failure));
      return;
    }
    // Even an untracked natural source was moved by a mob, not generated in place.
    var _ =
        levels
            .landFalling(id, destination)
            .thenCompose(
                marked ->
                    marked
                        ? CompletableFuture.completedFuture(true)
                        : levels.markPlaced(destination))
            .whenComplete((_, failure) -> logMoveFailure(failure));
  }

  @EventHandler(priority = EventPriority.MONITOR)
  void onEntityRemove(EntityRemoveEvent event) {
    if (event.getCause() == EntityRemoveEvent.Cause.UNLOAD
        || !(event.getEntity() instanceof FallingBlock || event.getEntity() instanceof Enderman)) {
      return;
    }
    var _ =
        levels
            .forgetFalling(event.getEntity().getUniqueId())
            .whenComplete((_, failure) -> logMoveFailure(failure));
  }

  private void logMoveFailure(Throwable failure) {
    if (failure != null) {
      context.logger().error("Could not move placed skill block marker", failure);
    }
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void onBreak(BlockBreakEvent event) {
    var player = event.getPlayer();
    var block = event.getBlock();
    var material = block.getType();
    boolean eligible = survival(player) && event.isDropItems();
    var skill = SkillActivities.block(block);
    Location location = block.getLocation();
    List<ItemStack> drops =
        skill.isPresent() && eligible
            ? block.getDrops(player.getInventory().getItemInMainHand()).stream()
                .map(ItemStack::clone)
                .toList()
            : List.of();
    var wasPlaced = levels.wasPlacedAndForget(position(block));
    if (Tag.FLOWERS.isTagged(material) && block.getBlockData() instanceof Bisected bisected) {
      var other =
          block.getRelative(
              bisected.getHalf() == Bisected.Half.TOP ? BlockFace.DOWN : BlockFace.UP);
      if (other.getType() == material) {
        wasPlaced =
            wasPlaced.thenCombine(
                levels.wasPlacedAndForget(position(other)), (first, second) -> first || second);
      }
    }
    var _ =
        wasPlaced.whenCompleteAsync(
            (placed, failure) -> {
              if (failure != null) {
                context.logger().error("Could not check skill block", failure);
              } else if (!placed && eligible && !drops.isEmpty()) {
                skill.ifPresent(
                    awarded -> {
                      award(player, awarded, SkillActivities.blockExperience(awarded, material));
                      extraDrops(player, awarded, location, drops);
                    });
              }
            },
            context.scheduler().mainThread());
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void onFish(PlayerFishEvent event) {
    if (survival(event.getPlayer()) && event.getState() == PlayerFishEvent.State.CAUGHT_FISH) {
      award(event.getPlayer(), Skill.FISHING, 20);
      if (event.getCaught() instanceof org.bukkit.entity.Item caught
          && bonus(event.getPlayer(), Skill.FISHING)) {
        caught.getWorld().dropItemNaturally(caught.getLocation(), caught.getItemStack().clone());
      }
    }
  }

  @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
  void onCombatPerk(EntityDamageByEntityEvent event) {
    if (!(event.getEntity() instanceof LivingEntity victim)
        || victim instanceof Player
        || ineligibleMob(victim)) {
      return;
    }
    Player attacker;
    if (event.getDamager() instanceof Player player) {
      attacker = player;
    } else if (event.getDamager() instanceof Projectile projectile
        && projectile.getShooter() instanceof Player player) {
      attacker = player;
    } else {
      return;
    }
    var progress = online.get(attacker.getUniqueId());
    if (progress == null || !survival(attacker)) {
      return;
    }
    SkillActivities.combat(event, attacker.getInventory().getItemInMainHand())
        .ifPresent(
            skill -> {
              event.setDamage(
                  event.getDamage() * SkillPerks.combatDamageMultiplier(progress.level(skill)));
            });
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void onDamageByEntity(EntityDamageByEntityEvent event) {
    if (!(event.getEntity() instanceof LivingEntity victim) || victim instanceof Player) {
      return;
    }
    Player player;
    if (event.getDamager() instanceof Player attacker) {
      player = attacker;
    } else if (event.getDamager() instanceof Projectile projectile
        && projectile.getShooter() instanceof Player shooter) {
      player = shooter;
    } else {
      return;
    }
    if (!survival(player)) {
      return;
    }
    SkillActivities.combat(event, player.getInventory().getItemInMainHand())
        .ifPresentOrElse(
            skill -> lastHits.put(victim, new Hit(player.getUniqueId(), skill)),
            () -> lastHits.remove(victim));
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void onDeath(EntityDeathEvent event) {
    var victim = event.getEntity();
    var hit = lastHits.remove(victim);
    var killer = victim.getKiller();
    if (hit == null
        || killer == null
        || !survival(killer)
        || !killer.getUniqueId().equals(hit.playerId())
        || ineligibleMob(victim)) {
      return;
    }
    award(killer, hit.skill(), 16);
  }

  @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
  void onFall(EntityDamageEvent event) {
    if (event.getCause() != EntityDamageEvent.DamageCause.FALL
        || !(event.getEntity() instanceof Player player)
        || !survival(player)) {
      return;
    }
    var progress = online.get(player.getUniqueId());
    if (progress != null) {
      event.setDamage(
          event.getDamage() * SkillPerks.fallDamageMultiplier(progress.level(Skill.ACROBATICS)));
    }
    var now = context.time().instant();
    var prior = lastAcrobatics.get(player.getUniqueId());
    if (event.getFinalDamage() > 0
        && (prior == null
            || !now.isBefore(prior.plusSeconds(config.acrobaticsCooldownSeconds())))) {
      lastAcrobatics.put(player.getUniqueId(), now);
      award(player, Skill.ACROBATICS, 10);
    }
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void onMend(PlayerItemMendEvent event) {
    if (survival(event.getPlayer()) && event.getRepairAmount() > 0) {
      award(event.getPlayer(), Skill.REPAIR, Math.min(100, event.getRepairAmount()));
    }
  }

  @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
  void onRepair(PlayerInteractEvent event) {
    if (event.getAction() != Action.RIGHT_CLICK_BLOCK
        || event.getHand() != EquipmentSlot.HAND
        || !survival(event.getPlayer())
        || event.getClickedBlock() == null
        || event.getClickedBlock().getType() != Material.IRON_BLOCK) {
      return;
    }
    var player = event.getPlayer();
    var tool = player.getInventory().getItemInMainHand();
    var ingredient = RepairMaterials.ingredient(tool.getType());
    var supplies = player.getInventory().getItemInOffHand();
    if (ingredient.isEmpty() || supplies.getType() != ingredient.orElseThrow()) {
      return;
    }
    if (!(tool.getItemMeta() instanceof Damageable damaged) || damaged.getDamage() <= 0) {
      return;
    }
    var progress = online.get(player.getUniqueId());
    int level = progress == null ? 0 : progress.level(Skill.REPAIR);
    int repaired =
        Math.min(damaged.getDamage(), RepairRules.amount(tool.getType().getMaxDurability(), level));
    damaged.setDamage(damaged.getDamage() - repaired);
    tool.setItemMeta(damaged);
    player.getInventory().setItemInMainHand(tool);
    if (supplies.getAmount() == 1) {
      player.getInventory().setItemInOffHand(null);
    } else {
      supplies.setAmount(supplies.getAmount() - 1);
      player.getInventory().setItemInOffHand(supplies);
    }
    event.setCancelled(true);
    award(player, Skill.REPAIR, repaired);
    player.sendMessage(Component.text("Repaired " + repaired + " durability."));
  }

  private void award(Player player, Skill skill, int experience) {
    var id = player.getUniqueId();
    var _ =
        levels
            .award(id, player.getName(), skill, experience)
            .whenCompleteAsync(
                (progress, failure) -> {
                  if (failure != null) {
                    context
                        .logger()
                        .error("Could not award {} experience to {}", skill, id, failure);
                    return;
                  }
                  if (!player.isOnline()) {
                    return;
                  }
                  var prior = online.get(id);
                  online.put(id, prior == null ? progress : newerProgress(prior, progress));
                  if (prior != null && progress.level(skill) > prior.level(skill)) {
                    player.sendMessage(
                        Component.text(
                            skill.displayName() + " reached level " + progress.level(skill) + "!"));
                  }
                },
                context.scheduler().mainThread());
  }

  /** Whether {@code player} earns skill progress: survival mode, outside any sealed world. */
  private boolean survival(Player player) {
    return player.getGameMode() == GameMode.SURVIVAL && !sealed.isSealed(player.getWorld());
  }

  private static BlockPosition position(Block block) {
    return new BlockPosition(block.getWorld().getUID(), block.getX(), block.getY(), block.getZ());
  }

  private static boolean ineligibleMob(LivingEntity victim) {
    var reason = victim.getEntitySpawnReason();
    return !(victim instanceof Mob)
        || reason == null
        || FARMED_SPAWNS.contains(reason.name())
        || victim.getScoreboardTags().stream().anyMatch(SCRIPTED_MOBS::contains);
  }

  private void extraDrops(Player player, Skill skill, Location location, List<ItemStack> drops) {
    if (!bonus(player, skill)) {
      return;
    }
    for (var drop : drops) {
      location.getWorld().dropItemNaturally(location, drop);
    }
  }

  private boolean bonus(Player player, Skill skill) {
    var progress = online.get(player.getUniqueId());
    return progress != null
        && context.random().nextDouble() < SkillPerks.extraDropChance(progress.level(skill));
  }

  private static SkillProgress newerProgress(SkillProgress prior, SkillProgress next) {
    var merged = new EnumMap<Skill, Long>(Skill.class);
    for (var skill : Skill.values()) {
      merged.put(
          skill,
          Math.max(
              prior.experience().getOrDefault(skill, 0L),
              next.experience().getOrDefault(skill, 0L)));
    }
    return new SkillProgress(merged);
  }
}
