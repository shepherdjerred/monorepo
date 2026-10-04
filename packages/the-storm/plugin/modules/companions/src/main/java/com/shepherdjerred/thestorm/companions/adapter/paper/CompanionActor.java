package com.shepherdjerred.thestorm.companions.adapter.paper;

import static java.util.Objects.requireNonNull;

import com.shepherdjerred.thestorm.companions.adapter.coreprotect.NaturalBlockAudit;
import com.shepherdjerred.thestorm.companions.app.CompanionState;
import com.shepherdjerred.thestorm.companions.app.CompanionStore;
import com.shepherdjerred.thestorm.companions.domain.Blueprint;
import com.shepherdjerred.thestorm.companions.domain.CompanionsConfig;
import com.shepherdjerred.thestorm.companions.domain.RecipePlanner;
import com.shepherdjerred.thestorm.companions.domain.SurvivalBrain;
import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.players.Humans;
import com.shepherdjerred.thestorm.core.protection.HarmTarget;
import com.shepherdjerred.thestorm.core.protection.ProtectedAction;
import com.shepherdjerred.thestorm.core.protection.Protection;
import java.time.Instant;
import java.util.Comparator;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.BooleanSupplier;
import java.util.function.Supplier;
import net.citizensnpcs.api.npc.NPC;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.Tag;
import org.bukkit.block.Block;
import org.bukkit.block.data.Ageable;
import org.bukkit.entity.Item;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Monster;
import org.bukkit.entity.Player;
import org.bukkit.inventory.EquipmentSlot;

/**
 * One bounded local survival agent. All world access and future completions stay on the tick
 * thread.
 */
final class CompanionActor {
  record Parts(
      ModuleContext context,
      CompanionsConfig config,
      CompanionStore store,
      NaturalBlockAudit audit,
      Protection protection,
      NativeRecipes recipes,
      BooleanSupplier active) {}

  private static final Set<String> GATHERABLE =
      Set.of(
          "OAK_LOG",
          "BIRCH_LOG",
          "SPRUCE_LOG",
          "JUNGLE_LOG",
          "ACACIA_LOG",
          "DARK_OAK_LOG",
          "MANGROVE_LOG",
          "CHERRY_LOG",
          "PALE_OAK_LOG",
          "COBBLESTONE",
          "WHEAT",
          "CARROT",
          "POTATO");
  private final ModuleContext context;
  private final CompanionsConfig config;
  private final CompanionsConfig.Identity identity;
  private final NPC npc;
  private final CompanionStore store;
  private final NaturalBlockAudit audit;
  private final Protection protection;
  private final SurvivalActions actions;
  private final NativeRecipes recipes;
  private final BooleanSupplier active;
  private Optional<CompanionState.Building> building;
  private Optional<UUID> following = Optional.empty();
  private Optional<LivingEntity> aggressor = Optional.empty();
  private Instant defendUntil = Instant.MIN;
  private Instant nextAction = Instant.MIN;
  private Optional<ResourceScan> scan = Optional.empty();
  private Optional<Block> mining = Optional.empty();
  private float breakProgress;
  private boolean stopped;
  private boolean busy;
  private boolean paused;

  private record IncomingDamage(double amount, org.bukkit.damage.DamageSource source) {}

  private Optional<IncomingDamage> lethal = Optional.empty();
  private Optional<CompanionState> deathState = Optional.empty();
  private boolean replayingLethal;

  CompanionActor(Parts parts, CompanionsConfig.Identity identity, NPC npc, CompanionState state) {
    this.context = parts.context();
    this.config = parts.config();
    this.identity = identity;
    this.npc = npc;
    this.store = parts.store();
    this.audit = parts.audit();
    this.protection = parts.protection();
    this.recipes = parts.recipes();
    this.active = parts.active();
    this.actions = new SurvivalActions(protection, audit);
    building = state.building();
  }

  NPC npc() {
    return npc;
  }

  String id() {
    return identity.id();
  }

  boolean busy() {
    return busy;
  }

  boolean paused() {
    return paused;
  }

  void follow(UUID player) {
    following = Optional.of(player);
    stopped = false;
    scan = Optional.empty();
  }

  void stop() {
    following = Optional.empty();
    stopped = true;
    npc.getNavigator().cancelNavigation();
  }

  void resume() {
    stopped = false;
  }

  void harmed(LivingEntity attacker) {
    aggressor = Optional.of(attacker);
    defendUntil = context.time().instant().plusSeconds(15);
  }

  CompanionState snapshot() {
    return deathState.orElseGet(() -> CompanionBody.snapshot(npc, building));
  }

  CompanionState snapshot(Player player) {
    return CompanionBody.snapshot(npc.getUniqueId(), player, building);
  }

  boolean replayingLethal() {
    return replayingLethal;
  }

  boolean died() {
    return deathState.isPresent();
  }

  void queueLethal(org.bukkit.event.entity.EntityDamageEvent event) {
    if (lethal.isEmpty() || event.getDamage() > lethal.get().amount())
      lethal = Optional.of(new IncomingDamage(event.getDamage(), event.getDamageSource()));
  }

  void died(org.bukkit.event.entity.PlayerDeathEvent event) {
    var before = snapshot(event.getEntity());
    var at = event.getEntity().getWorld().getSpawnLocation();
    var items =
        new org.bukkit.inventory.ItemStack
            [org.bukkit.inventory.ItemStack.deserializeItemsFromBytes(
                    java.util.Base64.getDecoder().decode(before.inventory()))
                .length];
    if (event.getItemsToKeep().size() > 36)
      throw new IllegalStateException("death retained items exceed storage");
    for (var index = 0; index < event.getItemsToKeep().size(); index++)
      items[index] = event.getItemsToKeep().get(index).clone();
    var inventory =
        event.getKeepInventory()
            ? before.inventory()
            : java.util.Base64.getEncoder()
                .encodeToString(org.bukkit.inventory.ItemStack.serializeItemsAsBytes(items));
    var experience = event.getKeepLevel() ? before.vitals().experience() : 0;
    deathState =
        Optional.of(
            new CompanionState(
                before.npcId(),
                new CompanionState.Position(
                    at.getWorld().getName(),
                    at.getX(),
                    at.getY(),
                    at.getZ(),
                    at.getYaw(),
                    at.getPitch()),
                new CompanionState.Vitals(20, 20, 5, event.getNewLevel(), experience),
                inventory,
                building));
  }

  void tick() {
    if (busy
        || paused
        || !active.getAsBoolean()
        || !npc.isSpawned()
        || context.time().instant().isBefore(nextAction)) return;
    var player = CompanionBody.player(npc);
    if (player.isDead()) return;
    if (lethal.isPresent()) {
      replayLethal(player, lethal.get());
      return;
    }
    var nearby = player.getNearbyEntities(8, 4, 8);
    var threat = threat(player, nearby);
    var stock = NativeRecipes.stock(player);
    var goal =
        SurvivalBrain.choose(
            new SurvivalBrain.Situation(
                threat.isPresent(),
                player.getFoodLevel(),
                meals(player),
                logs(stock),
                hasTool(player, "_PICKAXE"),
                stock.getOrDefault("COBBLESTONE", 0),
                completeBuilding(),
                following.isPresent(),
                stopped));
    if (urgent(player, goal, threat)) return;
    if (pickup(player, nearby)) return;
    if (mining.isPresent()) {
      mine(player, mining.get());
      return;
    }
    advanceGoal(player, goal);
  }

  private void advanceGoal(Player player, SurvivalBrain.Goal goal) {
    switch (goal) {
      case GATHER_WOOD -> find(player, "LOGS");
      case GATHER_STONE -> find(player, "COBBLESTONE");
      case CRAFT_TOOLS -> acquire(player, "STONE_PICKAXE", 1);
      case FARM -> farm(player);
      case BUILD -> build(player);
      case EXPLORE -> explore(player);
      case DEFEND, EAT, WAIT, FOLLOW ->
          throw new IllegalStateException("urgent goal was not dispatched");
    }
  }

  private boolean urgent(Player player, SurvivalBrain.Goal goal, Optional<LivingEntity> threat) {
    return switch (goal) {
      case DEFEND -> {
        fight(player, threat.orElseThrow());
        yield true;
      }
      case EAT -> {
        eat(player);
        yield true;
      }
      case WAIT -> true;
      case FOLLOW -> {
        follow(player);
        yield true;
      }
      case GATHER_WOOD, GATHER_STONE, CRAFT_TOOLS, FARM, BUILD, EXPLORE -> false;
    };
  }

  private void replayLethal(Player player, IncomingDamage damage) {
    lethal = Optional.empty();
    effect(
        "native lethal damage",
        () -> {
          replayingLethal = true;
          try {
            player.damage(damage.amount(), damage.source());
          } finally {
            replayingLethal = false;
          }
          return true;
        });
  }

  private void follow(Player player) {
    var target =
        following
            .flatMap(id -> Optional.ofNullable(context.plugin().getServer().getPlayer(id)))
            .filter(Humans::isHuman);
    if (target.isEmpty() || !player.getWorld().equals(target.get().getWorld())) {
      following = Optional.empty();
      return;
    }
    var spot = requireNonNull(target.get().getLocation());
    if (spot.distanceSquared(requireNonNull(player.getLocation())) > 9
        && spot.distanceSquared(requireNonNull(player.getLocation())) <= 1024) navigate(spot);
    else npc.getNavigator().cancelNavigation();
  }

  private void fight(Player player, LivingEntity target) {
    if (!target.getWorld().equals(player.getWorld())
        || target.getLocation().distanceSquared(requireNonNull(player.getLocation())) > 256) return;
    var pvp =
        io.papermc.paper.registry.RegistryAccess.registryAccess()
            .getRegistry(io.papermc.paper.registry.RegistryKey.GAME_RULE)
            .getOrThrow(io.papermc.paper.registry.keys.GameRuleKeys.PVP);
    if (target instanceof Player
        && (!Boolean.TRUE.equals(player.getWorld().getGameRuleValue(pvp))
            || !protection
                .checkHarm(
                    player.getUniqueId(),
                    requireNonNull(player.getLocation()),
                    HarmTarget.PLAYER,
                    target.getLocation())
                .isAllowed())) return;
    if (!(target instanceof Monster) && !(target instanceof Player)) return;
    if (target.getLocation().distanceSquared(requireNonNull(player.getLocation())) > 9) {
      navigate(target.getLocation());
      return;
    }
    if (!player.hasLineOfSight(target)) return;
    effect(
        "defend " + target.getUniqueId(),
        () -> {
          equipBest(player, "_SWORD");
          npc.faceLocation(target.getLocation());
          player.swingMainHand();
          player.attack(target);
          return true;
        });
  }

  private void eat(Player player) {
    var food =
        java.util.Arrays.stream(requireNonNull(player.getInventory().getStorageContents()))
            .filter(
                item ->
                    item != null
                        && item.getType().isEdible()
                        && item.getType() != Material.ROTTEN_FLESH
                        && item.getType() != Material.SPIDER_EYE
                        && item.getType() != Material.POISONOUS_POTATO
                        && item.getType() != Material.PUFFERFISH)
            .findFirst();
    if (food.isEmpty()) return;
    effect(
        "eat " + food.get().getType(),
        () -> {
          SurvivalActions.equip(player, food.get().getType());
          player.startUsingItem(EquipmentSlot.HAND);
          player.completeUsingActiveItem();
          return true;
        });
  }

  private void acquire(Player player, String output, int amount) {
    var stock = NativeRecipes.stock(player);
    var selected = recipes.select(stock);
    var catalog =
        selected.entrySet().stream()
            .filter(entry -> entry.getValue().plan().station() != RecipePlanner.Station.FURNACE)
            .collect(
                java.util.stream.Collectors.toUnmodifiableMap(
                    Map.Entry::getKey, entry -> entry.getValue().plan()));
    var plan = new RecipePlanner(catalog, GATHERABLE).plan(output, amount, stock);
    if (plan.isEmpty() || plan.get().isEmpty()) {
      explore(player);
      return;
    }
    switch (plan.get().getFirst()) {
      case RecipePlanner.Step.Gather(var material, var _) -> find(player, material);
      case RecipePlanner.Step.Craft(var recipe, var _) -> {
        var station = workbench(player);
        if (recipe.station() == RecipePlanner.Station.WORKBENCH && station.isEmpty()) {
          installWorkbench(player);
          return;
        }
        var chosen = selected.get(recipe.output());
        if (chosen == null)
          throw new IllegalStateException("planned recipe missing from server catalog");
        effect("craft " + recipe.key(), () -> recipes.craft(player, chosen, station));
      }
    }
  }

  private Optional<Location> workbench(Player player) {
    return NearbyBlocks.box(requireNonNull(player.getLocation()), 3, 1)
        .filter(block -> block.getType() == Material.CRAFTING_TABLE)
        .filter(
            block ->
                actions.allowed(player, ProtectedAction.INTERACT, block)
                    && SurvivalActions.reach(player, block))
        .map(Block::getLocation)
        .findFirst();
  }

  private Optional<LivingEntity> threat(
      Player player, java.util.List<org.bukkit.entity.Entity> nearby) {
    return aggressor
        .filter(entity -> entity.isValid() && context.time().instant().isBefore(defendUntil))
        .or(
            () ->
                nearby.stream()
                    .filter(Monster.class::isInstance)
                    .map(Monster.class::cast)
                    .filter(monster -> player.equals(monster.getTarget()))
                    .map(LivingEntity.class::cast)
                    .findFirst());
  }

  private boolean pickup(Player player, java.util.List<org.bukkit.entity.Entity> nearby) {
    var drops =
        nearby.stream()
            .filter(Item.class::isInstance)
            .map(Item.class::cast)
            .filter(
                item -> item.getThrower() == null || player.getUniqueId().equals(item.getThrower()))
            .filter(item -> item.getPickupDelay() == 0)
            .findFirst();
    if (drops.isEmpty()) return false;
    if (drops.get().getLocation().distanceSquared(requireNonNull(player.getLocation())) > 4) {
      navigate(drops.get().getLocation());
      return true;
    }
    effect("pickup " + drops.get().getUniqueId(), () -> actions.pickup(player, drops.get()));
    return true;
  }

  private void installWorkbench(Player player) {
    if (NativeRecipes.stock(player).getOrDefault("CRAFTING_TABLE", 0) == 0) {
      acquire(player, "CRAFTING_TABLE", 1);
      return;
    }
    var here = requireNonNull(player.getLocation()).getBlock();
    for (var dx = -1; dx <= 1; dx++)
      for (var dz = -1; dz <= 1; dz++) {
        var target = here.getRelative(dx, 0, dz);
        if ((dx != 0 || dz != 0)
            && target.isEmpty()
            && target.getRelative(0, -1, 0).getType().isSolid()
            && actions.allowed(player, ProtectedAction.BUILD, target)) {
          auditedEffect(
              target,
              "place crafting table",
              () -> actions.place(player, target, Material.CRAFTING_TABLE, owner()));
          return;
        }
      }
    explore(player);
  }

  private void find(Player player, String material) {
    var scanning =
        scan.orElseGet(
            () -> new ResourceScan(requireNonNull(player.getLocation()), config.scanRadius()));
    scan = Optional.of(scanning);
    var candidate =
        scanning.advance(
            config.scanBlocksPerTick(),
            block ->
                resource(block, material)
                    && actions.allowed(player, ProtectedAction.BREAK, block)
                    && exposed(block));
    if (candidate.isPresent()) {
      scan = Optional.empty();
      mining = candidate;
      breakProgress = 0;
      mine(player, candidate.get());
    } else if (scanning.finished()) {
      scan = Optional.empty();
      explore(player);
    }
  }

  private void farm(Player player) {
    var plot =
        NativeRecipes.stock(player).getOrDefault("WHEAT_SEEDS", 0) > 0
            ? NearbyBlocks.box(requireNonNull(player.getLocation()), 4, 1)
                .filter(
                    block ->
                        block.isEmpty()
                            && block.getRelative(0, -1, 0).getType() == Material.FARMLAND
                            && actions.allowed(player, ProtectedAction.BUILD, block)
                            && SurvivalActions.reach(player, block))
                .findFirst()
            : Optional.<Block>empty();
    if (plot.isPresent())
      auditedEffect(plot.get(), "replant wheat", () -> actions.plant(player, plot.get(), owner()));
    else acquire(player, "BREAD", 12);
  }

  private static boolean resource(Block block, String material) {
    if (material.equals("LOGS")) return Tag.LOGS.isTagged(block.getType());
    if (material.equals("COBBLESTONE"))
      return block.getType() == Material.STONE || block.getType() == Material.COBBLESTONE;
    if (material.equals("WHEAT") || material.equals("CARROT") || material.equals("POTATO"))
      return block.getBlockData() instanceof Ageable crop
          && crop.getAge() == crop.getMaximumAge()
          && block.getType()
              == Material.valueOf(
                  material.equals("CARROT")
                      ? "CARROTS"
                      : material.equals("POTATO") ? "POTATOES" : material);
    return block.getType().name().equals(material);
  }

  static boolean exposed(Block block) {
    return java.util.List.of(
            org.bukkit.block.BlockFace.UP,
            org.bukkit.block.BlockFace.DOWN,
            org.bukkit.block.BlockFace.NORTH,
            org.bukkit.block.BlockFace.SOUTH,
            org.bukkit.block.BlockFace.EAST,
            org.bukkit.block.BlockFace.WEST)
        .stream()
        .map(block::getRelative)
        .anyMatch(
            neighbor ->
                neighbor.getY() >= neighbor.getWorld().getMinHeight()
                    && neighbor.getY() < neighbor.getWorld().getMaxHeight()
                    && neighbor.getWorld().isChunkLoaded(neighbor.getX() >> 4, neighbor.getZ() >> 4)
                    && neighbor.isPassable());
  }

  private void mine(Player player, Block block) {
    if (!actions.allowed(player, ProtectedAction.BREAK, block) || block.isEmpty()) {
      mining = Optional.empty();
      return;
    }
    if (!SurvivalActions.reach(player, block)) {
      var approach = SurvivalActions.approach(player, block);
      if (approach.isPresent()) navigate(approach.get());
      else {
        mining = Optional.empty();
        explore(player);
      }
      return;
    }
    npc.getNavigator().cancelNavigation();
    npc.faceLocation(block.getLocation().add(0.5, 0.5, 0.5));
    if (Tag.LOGS.isTagged(block.getType())) equipBest(player, "_AXE");
    else equipBest(player, "_PICKAXE");
    breakProgress += block.getBreakSpeed(player) * config.thinkTicks();
    player.swingMainHand();
    if (breakProgress < 1) return;
    var expected = block.getType();
    mining = Optional.empty();
    auditedEffect(
        block,
        "mine " + expected + " " + block.getX() + "," + block.getY() + "," + block.getZ(),
        () -> actions.mine(player, block, expected, owner()));
  }

  private boolean completeBuilding() {
    return building
        .filter(
            progress ->
                progress.nextBlock()
                    == Blueprint.rectangular(
                            progress.width(), progress.depth(), progress.material())
                        .blocks()
                        .size())
        .isPresent();
  }

  private void build(Player player) {
    if (building.isEmpty()) {
      designBuilding(player);
      return;
    }
    var progress = building.get();
    var plan = Blueprint.rectangular(progress.width(), progress.depth(), progress.material());
    if (progress.nextBlock() >= plan.blocks().size()) return;
    if (NativeRecipes.stock(player).getOrDefault(progress.material(), 0) == 0) {
      acquire(
          player, progress.material(), Math.min(64, plan.blocks().size() - progress.nextBlock()));
      return;
    }
    var world = context.plugin().getServer().getWorld(progress.origin().world());
    if (world == null) throw new IllegalStateException("building world disappeared");
    var step = plan.blocks().get(progress.nextBlock());
    var block =
        world.getBlockAt(
            (int) progress.origin().x() + step.x(),
            (int) progress.origin().y() + step.y(),
            (int) progress.origin().z() + step.z());
    if (!world.isChunkLoaded(block.getX() >> 4, block.getZ() >> 4)) return;
    if (!SurvivalActions.reach(player, block)
        || org.bukkit.util.BoundingBox.of(block).overlaps(player.getBoundingBox())) {
      SurvivalActions.approach(player, block).ifPresent(this::navigate);
      return;
    }
    if (!block.isEmpty()) {
      paused = true;
      context
          .logger()
          .error(
              "Companion {} building obstructed at {}: operator inspection required",
              id(),
              block.getLocation());
      return;
    }
    auditedEffect(
        block,
        "build " + progress.nextBlock(),
        () -> {
          if (!actions.place(player, block, Material.valueOf(progress.material()), owner()))
            return false;
          building =
              Optional.of(
                  new CompanionState.Building(
                      progress.origin(),
                      progress.width(),
                      progress.depth(),
                      progress.material(),
                      progress.nextBlock() + 1));
          return true;
        });
  }

  private void designBuilding(Player player) {
    var stock = NativeRecipes.stock(player);
    var material =
        stock.keySet().stream()
            .filter(key -> key.endsWith("_LOG"))
            .sorted()
            .findFirst()
            .map(key -> key.replace("_LOG", "_PLANKS"))
            .orElse("OAK_PLANKS");
    var plan = Blueprint.shelter(context.random(), material);
    var at = requireNonNull(player.getLocation()).getBlock().getRelative(3, 0, 3).getLocation();
    var footprint = NearbyBlocks.footprint(at, plan.width(), plan.depth(), 5).toList();
    if (footprint.size() != plan.width() * plan.depth() * 5
        || footprint.stream()
            .anyMatch(block -> !validBuildingBlock(player, block, at.getBlockY()))) {
      explore(player);
      return;
    }
    building =
        Optional.of(
            new CompanionState.Building(
                new CompanionState.Position(
                    at.getWorld().getName(), at.getX(), at.getY(), at.getZ(), 0, 0),
                plan.width(),
                plan.depth(),
                material,
                0));
    persist();
  }

  private boolean validBuildingBlock(Player player, Block block, int floor) {
    return actions.allowed(player, ProtectedAction.BUILD, block)
        && block.isEmpty()
        && (block.getY() != floor || block.getRelative(0, -1, 0).getType().isSolid());
  }

  private void explore(Player player) {
    if (npc.getNavigator().isNavigating()) return;
    var at = requireNonNull(player.getLocation());
    var x = at.getBlockX() + context.random().nextInt(-12, 13);
    var z = at.getBlockZ() + context.random().nextInt(-12, 13);
    if (!player.getWorld().isChunkLoaded(x >> 4, z >> 4)) return;
    var surface = player.getWorld().getHighestBlockAt(x, z);
    if (surface.getType().isSolid() && surface.getRelative(0, 1, 0).isPassable())
      navigate(surface.getLocation().add(0.5, 1, 0.5));
  }

  private void navigate(Location destination) {
    var previous = npc.getNavigator().getTargetAsLocation();
    if (npc.getNavigator().isNavigating()
        && previous != null
        && previous.getWorld().equals(destination.getWorld())
        && previous.distanceSquared(destination) < 0.01) return;
    npc.getNavigator().setTarget(destination);
  }

  private String owner() {
    return "#storm-" + id();
  }

  private void auditedEffect(Block block, String description, Supplier<Boolean> action) {
    busy = true;
    var expected = block.getBlockData().getAsString();
    var _ =
        audit
            .natural(block, owner(), CompanionBody.player(npc).getName())
            .whenCompleteAsync(
                (natural, failure) -> {
                  busy = false;
                  if (failure != null) {
                    fail(failure);
                    return;
                  }
                  if (!natural
                      || !active.getAsBoolean()
                      || !expected.equals(block.getBlockData().getAsString())) return;
                  effect(description, action);
                },
                context.scheduler().mainThread());
  }

  private void effect(String description, Supplier<Boolean> action) {
    busy = true;
    npc.getNavigator().cancelNavigation();
    var before = snapshot();
    var _ =
        store
            .begin(id(), before, description)
            .whenCompleteAsync(
                (ignored, failure) -> {
                  if (failure != null) {
                    fail(failure);
                    busy = false;
                    return;
                  }
                  var after = before;
                  try {
                    if (active.getAsBoolean() && npc.isSpawned()) {
                      var _ = action.get();
                      after = snapshot();
                    }
                  } catch (RuntimeException error) {
                    fail(error);
                    busy = false;
                    return;
                  }
                  var _ =
                      store
                          .finish(id(), after)
                          .whenCompleteAsync(
                              (finished, error) -> {
                                busy = false;
                                nextAction =
                                    context
                                        .time()
                                        .instant()
                                        .plusMillis(config.actionCooldownTicks() * 50L);
                                if (error != null) fail(error);
                              },
                              context.scheduler().mainThread());
                },
                context.scheduler().mainThread());
  }

  void persist() {
    if (busy || paused || !npc.isSpawned()) return;
    busy = true;
    var _ =
        store
            .save(id(), snapshot())
            .whenCompleteAsync(
                (ignored, error) -> {
                  busy = false;
                  if (error != null) fail(error);
                },
                context.scheduler().mainThread());
  }

  private void fail(Throwable error) {
    paused = true;
    npc.getNavigator().cancelNavigation();
    context
        .logger()
        .error("Companion {} paused: persistent state or world effect failed", id(), error);
  }

  private static int logs(Map<String, Integer> stock) {
    return stock.entrySet().stream()
        .filter(entry -> Tag.LOGS.isTagged(Material.valueOf(entry.getKey())))
        .mapToInt(Map.Entry::getValue)
        .sum();
  }

  private static int meals(Player player) {
    return java.util.Arrays.stream(requireNonNull(player.getInventory().getStorageContents()))
        .filter(item -> item != null && item.getType().isEdible())
        .mapToInt(org.bukkit.inventory.ItemStack::getAmount)
        .sum();
  }

  private static boolean hasTool(Player player, String suffix) {
    return NativeRecipes.stock(player).keySet().stream().anyMatch(key -> key.endsWith(suffix));
  }

  private static void equipBest(Player player, String suffix) {
    NativeRecipes.stock(player).keySet().stream()
        .filter(key -> key.endsWith(suffix))
        .min(Comparator.naturalOrder())
        .map(Material::valueOf)
        .ifPresent(material -> SurvivalActions.equip(player, material));
  }
}
