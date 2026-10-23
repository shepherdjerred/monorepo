// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/game/searchanddestroy/killstreak/
// KillstreakManager.java, StreakBase.java and streaks/*.java); see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.rwf.app.ActionRefusal;
import com.shepherdjerred.thestorm.rwf.app.JoinGate;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Ghost;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Wraith;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.geometry.BlockPos;
import com.shepherdjerred.thestorm.rwf.domain.killstreak.Delivery;
import com.shepherdjerred.thestorm.rwf.domain.killstreak.Killstreak;
import com.shepherdjerred.thestorm.rwf.domain.match.Combatant;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchEffect;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextDecoration;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.Sound;
import org.bukkit.block.Block;
import org.bukkit.block.BlockFace;
import org.bukkit.entity.FallingBlock;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.bukkit.util.Vector;

/**
 * Red Warfare's killstreak rewards on the server. An earned reward is announced and its item given,
 * if killstreaks are on for the player. The compass is used where it is held; every other item is
 * used on a block, and a block falls from far above to deliver it on the clear spot against the
 * face clicked: a supply crate ({@link SupplyCrates}), three attack dogs or an iron golem ({@link
 * Summons}), or napalm ({@link Napalm}). As in Red Warfare, an item is known by its material alone
 * in a fighter's hands, and either click on a block uses it. Everything a reward put in the world
 * goes when the match resets. Main thread only.
 */
final class Killstreaks {

  /**
   * A reward on its way down.
   *
   * @param owner who used it
   * @param streak which reward
   * @param block the falling block
   */
  private record Drop(CombatantId owner, Killstreak streak, FallingBlock block) {}

  private final MatchRunner runner;
  private final PaperContext context;
  private final Keys keys;
  private final JoinGate gate;
  private final Summons summons;
  private final StreakBlocks blocks;
  private final SupplyCrates crates;
  private final Napalm napalm;
  private final Map<UUID, Drop> falling = new HashMap<>();
  private final Map<String, Instant> recharges = new HashMap<>();
  private final double[] stray = new double[3];
  private long ticks;

  /**
   * What the rewards need.
   *
   * @param keys item and entity tags
   * @param gate the per-player killstreaks flag
   * @param tracker hit bookkeeping, for the summons' blows and napalm's fire
   * @param explosions the kit explosions, for napalm's blast
   */
  record Parts(Keys keys, JoinGate gate, CombatTracker tracker, KitExplosions explosions) {}

  Killstreaks(MatchRunner runner, PaperContext context, Parts parts) {
    this.runner = runner;
    this.context = context;
    this.keys = parts.keys();
    this.gate = parts.gate();
    this.summons = new Summons(runner, context, parts.keys(), parts.tracker());
    this.blocks = new StreakBlocks(context);
    this.crates = new SupplyCrates(runner, context, parts.keys(), blocks);
    this.napalm =
        new Napalm(
            runner,
            context,
            summons,
            new Napalm.Parts(parts.keys(), parts.explosions(), blocks, parts.tracker()));
  }

  /**
   * The server operations the rewards need and the battlefield the summons' blows sound on; given
   * once, as the module starts.
   */
  void hooks(ServerHooks hooks, com.shepherdjerred.thestorm.rwf.app.BattleSounds battlefield) {
    summons.hooks(hooks, battlefield);
  }

  Summons summons() {
    return summons;
  }

  Napalm napalm() {
    return napalm;
  }

  // ---- earning ------------------------------------------------------------------------------

  /**
   * {@code earned} reached a reward: if killstreaks are on for them and they are still fighting,
   * they are told and given its item.
   */
  void grant(MatchEffect.KillstreakEarned earned) {
    var matchId = runner.match().matchId();
    var entity = runner.entity(earned.id());
    if (entity.isEmpty()) {
      return;
    }
    context.onMain(
        gate.allows(entity.orElseThrow().getUniqueId()),
        allowed -> {
          var player = runner.entity(earned.id());
          if (allowed
              && runner.match().matchId().equals(matchId)
              && player.isPresent()
              && fighting(earned.id())
              && runner
                  .member(earned.id())
                  .orElseThrow()
                  .streaks()
                  .rewards()
                  .contains(earned.earned().streak())) {
            give(player.orElseThrow(), earned.earned());
          }
        },
        "grant a killstreak");
  }

  private boolean fighting(CombatantId id) {
    return runner.live() && runner.member(id).filter(Combatant::alive).isPresent();
  }

  /**
   * Red Warfare's giving: a Ghost or Wraith gets the item in its second empty slot of the whole
   * inventory (worn armour and the off hand included), since the first is the empty hand that hides
   * it, and gets nothing if there is no second; anyone else gets it added to their inventory.
   */
  private void give(Player player, Killstreak.Earned earned) {
    player.sendMessage(
        Component.text(
            "Killstreak of " + earned.kills() + "! Given " + earned.streak().title() + "!",
            NamedTextColor.BLUE));
    var item = item(earned.streak());
    var hiding =
        runner
            .memberOf(player.getUniqueId())
            .flatMap(Combatant::kit)
            .filter(Set.of(Ghost.ID, Wraith.ID)::contains)
            .isPresent();
    if (!hiding) {
      player.getInventory().addItem(item);
      return;
    }
    var inventory = player.getInventory();
    var foundEmpty = false;
    for (var slot = 0; slot < inventory.getSize(); slot++) {
      var stack = inventory.getItem(slot);
      if (stack != null && !stack.isEmpty()) {
        continue;
      }
      if (foundEmpty) {
        inventory.setItem(slot, item);
        return;
      }
      foundEmpty = true;
    }
  }

  /** {@code streak}'s item, as Red Warfare built it. */
  ItemStack item(Killstreak streak) {
    var look = streak.look();
    var stack = ItemStack.of(Material.valueOf(streak.item()));
    stack.editMeta(
        meta -> {
          var name =
              Component.text(look.name(), color(look.color()))
                  .decoration(TextDecoration.ITALIC, false);
          meta.displayName(look.bold() ? name.decorate(TextDecoration.BOLD) : name);
          if (!look.lore().isEmpty()) {
            meta.lore(
                look.lore().stream()
                    .map(
                        line ->
                            (Component)
                                Component.text(line, color(look.loreColor()))
                                    .decoration(TextDecoration.ITALIC, false))
                    .toList());
          }
        });
    keys.tagStreak(stack, streak);
    return stack;
  }

  private static NamedTextColor color(String name) {
    var color = NamedTextColor.NAMES.value(name);
    if (color == null) {
      throw new IllegalArgumentException("not a colour: " + name);
    }
    return color;
  }

  // ---- using --------------------------------------------------------------------------------

  /**
   * The reward {@code stack} carries: a tagged killstreak item anywhere, or, in a fighter's hands,
   * any item of a reward's material, as Red Warfare matched them.
   */
  private Optional<Killstreak> streakOf(Player player, ItemStack stack) {
    var tagged = keys.streak(stack);
    if (tagged.isPresent() || !runner.fighting(player.getUniqueId())) {
      return tagged;
    }
    return Killstreak.byItem(stack.getType().name());
  }

  /**
   * {@code player} clicked with {@code stack}, on {@code clicked}'s {@code face} if they clicked a
   * block. Returns whether it was a killstreak item, so the server's own use is denied.
   */
  boolean use(Player player, ItemStack stack, Optional<Block> clicked, BlockFace face) {
    var streak = streakOf(player, stack);
    if (streak.isEmpty()) {
      return false;
    }
    var member = runner.memberOf(player.getUniqueId());
    if (member.isEmpty() || !fighting(member.orElseThrow().id())) {
      return true;
    }
    if (streak.orElseThrow() == Killstreak.COMPASS) {
      track(player, member.orElseThrow());
      return true;
    }
    if (clicked.isEmpty()) {
      return true;
    }
    var target = clicked.orElseThrow().getRelative(face);
    var refused = refusal(streak.orElseThrow(), target);
    if (refused.isPresent()) {
      if (!refused.orElseThrow().isEmpty()) {
        player.sendMessage(Component.text(refused.orElseThrow(), NamedTextColor.RED));
      }
      return true;
    }
    removeOne(player, stack.getType());
    drop(member.orElseThrow(), player, streak.orElseThrow(), target);
    return true;
  }

  /**
   * A bot uses the first reward it carries that falls from the sky, at its feet; why not, if it
   * cannot.
   */
  Optional<ActionRefusal> useCarried(Player bot) {
    var member = runner.memberOf(bot.getUniqueId());
    if (member.isEmpty() || !fighting(member.orElseThrow().id())) {
      return Optional.of(ActionRefusal.NOT_ALIVE);
    }
    var inventory = bot.getInventory();
    for (var slot = 0; slot < inventory.getSize(); slot++) {
      var stack = inventory.getItem(slot);
      var streak = stack == null ? Optional.<Killstreak>empty() : keys.streak(stack);
      if (stack == null || streak.filter(Killstreak::dropped).isEmpty()) {
        continue;
      }
      var target = Places.at(bot).getBlock();
      if (refusal(streak.orElseThrow(), target).isPresent()) {
        return Optional.of(ActionRefusal.OUT_OF_REACH);
      }
      removeOne(bot, stack.getType());
      drop(member.orElseThrow(), bot, streak.orElseThrow(), target);
      return Optional.empty();
    }
    return Optional.of(ActionRefusal.NO_KIT_ITEM);
  }

  /**
   * Why {@code streak} cannot be called in on {@code target}: a crate keeps clear of other crates
   * and of the bombs, as its owner is told; then any reward needs air on a whole solid block, a
   * silent refusal.
   */
  private Optional<String> refusal(Killstreak streak, Block target) {
    if (streak == Killstreak.SUPPLY_CRATE) {
      var landing =
          falling.values().stream()
              .filter(drop -> drop.streak() == Killstreak.SUPPLY_CRATE)
              .map(drop -> Places.at(drop.block()))
              .toList();
      var crowded = crates.refusal(target, landing);
      if (crowded.isPresent()) {
        return crowded;
      }
    }
    if (!target.getType().isAir() || !Ground.fullSolid(target.getRelative(BlockFace.DOWN))) {
      return Optional.of("");
    }
    return Optional.empty();
  }

  /**
   * Takes one item of {@code material}, from the off hand first, then the main hand, then the
   * inventory, as Red Warfare's {@code UtilInv.remove} did.
   */
  private static void removeOne(Player player, Material material) {
    var inventory = player.getInventory();
    var offHand = inventory.getItemInOffHand();
    if (offHand.getType() == material) {
      offHand.subtract();
      return;
    }
    var mainHand = inventory.getItemInMainHand();
    if (mainHand.getType() == material) {
      mainHand.subtract();
      return;
    }
    for (var slot = 0; slot < inventory.getSize(); slot++) {
      var stack = inventory.getItem(slot);
      if (stack != null && stack.getType() == material) {
        stack.subtract();
        return;
      }
    }
  }

  /**
   * The reward's block falls from far above {@code target}: about a hundred blocks over it and at
   * least fifty over the first air above its column. Everyone near hears when napalm is on its way.
   */
  private void drop(Combatant owner, Player player, Killstreak streak, Block target) {
    var world = target.getWorld();
    // Paper names the topmost block; the server Red Warfare ran on named the air above it.
    var highest = world.getHighestBlockYAt(target.getX(), target.getZ()) + 1;
    var at =
        new Location(
            world,
            target.getX() + 0.5,
            Delivery.dropHeight(highest, target.getY()),
            target.getZ() + 0.5);
    runner
        .hooks()
        .killstreakUsed(
            owner.id(),
            MatchRunner.machineName(streak.name()),
            // Earned at its count or later in the streak, so never fewer kills than it needs.
            Math.max(streak.kills(), (int) Math.floor(owner.score().killstreak())));
    var material = Material.valueOf(streak.falling().orElseThrow());
    var block = world.spawn(at, FallingBlock.class, spawned -> configure(spawned, material));
    falling.put(block.getUniqueId(), new Drop(owner.id(), streak, block));
    if (streak == Killstreak.NAPALM) {
      napalm.warn(owner, player);
    }
  }

  private void configure(FallingBlock block, Material material) {
    block.setBlockData(material.createBlockData());
    block.setDropItem(false);
    block.setCancelDrop(true);
    block.setHurtEntities(false);
    block.setPersistent(false);
    keys.tagKitEntity(block);
  }

  // ---- landing ------------------------------------------------------------------------------

  /** Whether {@code entity} is a reward on its way down. */
  boolean isFalling(org.bukkit.entity.Entity entity) {
    return falling.containsKey(entity.getUniqueId());
  }

  /**
   * The falling {@code entity} came down at {@code where} (or vanished there): the reward is
   * delivered, if its owner is still fighting and it came down above y 0. All but napalm settle on
   * the nearest clear block within ten.
   */
  void land(org.bukkit.entity.Entity entity, Location where) {
    var drop = falling.remove(entity.getUniqueId());
    if (drop == null) {
      return;
    }
    entity.remove();
    var owner = runner.entity(drop.owner());
    if (owner.isEmpty() || !fighting(drop.owner()) || where.getY() < 0) {
      return;
    }
    var block = where.getBlock();
    if (drop.streak() != Killstreak.NAPALM) {
      block = settle(block);
    }
    block
        .getWorld()
        .playSound(
            block.getLocation(),
            Sound.ENTITY_GENERIC_EXPLODE,
            Delivery.LANDING_VOLUME,
            Delivery.LANDING_PITCH);
    var team = runner.member(drop.owner()).flatMap(Combatant::team).orElseThrow();
    var player = owner.orElseThrow();
    switch (drop.streak()) {
      case SUPPLY_CRATE -> crates.land(player, drop.owner(), team, block);
      case WOLVES -> {
        summons.dogs(player, drop.owner(), team, block.getLocation().add(0.5, 0, 0.5));
        player.sendMessage(Component.text("Attack dogs have arrived!", NamedTextColor.BLUE));
      }
      case IRON_GOLEM ->
          summons.golem(player, drop.owner(), team, block.getLocation().add(0.5, 0, 0.5));
      case NAPALM -> napalm.land(player, drop.owner(), team, block);
      case COMPASS -> throw new IllegalStateException("the compass is never dropped");
    }
  }

  /**
   * Red Warfare's settling, ten steps: up out of anything one cannot walk through, down while the
   * block below can be walked through.
   */
  private static Block settle(Block start) {
    var block = start;
    for (var i = 0; i < Delivery.SETTLE_STEPS; i++) {
      if (!Ground.nonSolid(block)) {
        block = block.getRelative(BlockFace.UP);
      } else if (Ground.nonSolid(block.getRelative(BlockFace.DOWN))) {
        block = block.getRelative(BlockFace.DOWN);
      }
    }
    return block;
  }

  /** {@code player} right-clicked {@code block}; whether it is a supply crate. */
  boolean loot(Player player, Block block) {
    return crates.loot(player, block);
  }

  // ---- the compass --------------------------------------------------------------------------

  /**
   * The compass points at the nearest living enemy, roughly when it is a Ghost or Wraith; the enemy
   * hears that they were found at most every thirty seconds.
   */
  private void track(Player player, Combatant self) {
    var target = nearestEnemy(player, self);
    if (target.isEmpty()) {
      player.sendMessage(Component.text("No targets found!", NamedTextColor.RED));
      return;
    }
    var closest = target.orElseThrow().player();
    var found = target.orElseThrow().member();
    if (ready(closest.getUniqueId() + ":" + player.getUniqueId(), Delivery.COMPASS_WARNING)) {
      closest.playSound(
          Places.at(closest),
          Sound.ENTITY_EXPERIENCE_ORB_PICKUP,
          Delivery.COMPASS_VOLUME,
          Delivery.COMPASS_PITCH);
      closest.sendMessage(
          Component.text(
              player.getName() + " has found you with their compass", NamedTextColor.RED));
    }
    var ghost = found.kit().filter(Set.of(Ghost.ID, Wraith.ID)::contains).isPresent();
    var at = Places.at(closest);
    if (ghost) {
      at.add(stray[0], stray[1], stray[2]);
    }
    if (ready("message:" + player.getUniqueId(), Delivery.COMPASS_MESSAGE)) {
      player.sendMessage(
          Component.text(
              "Tracking player "
                  + closest.getName()
                  + ", they're "
                  + (ghost ? "maybe " : "")
                  + (int) Places.at(player).distance(at)
                  + " blocks away"
                  + (ghost ? "??" : "."),
              NamedTextColor.RED));
    }
    player.setCompassTarget(at);
  }

  /**
   * A combatant and their entity.
   *
   * @param player the entity
   * @param member the combatant
   */
  private record Target(Player player, Combatant member) {}

  /**
   * The living enemy of {@code self} nearest {@code player}, in the same world. Red Warfare went
   * through the players in a shuffled order and took the last of equally near ones.
   */
  private Optional<Target> nearestEnemy(Player player, Combatant self) {
    var members = new ArrayList<>(runner.match().members());
    Collections.shuffle(members, runner.match().random(runner.now()));
    Optional<Target> closest = Optional.empty();
    var distance = 0.0;
    for (var member : members) {
      var entity =
          runner
              .entity(member.id())
              .filter(other -> member.alive() && !member.team().equals(self.team()))
              .filter(other -> other.getWorld().equals(player.getWorld()));
      if (entity.isEmpty()) {
        continue;
      }
      var away = Places.at(entity.orElseThrow()).distance(Places.at(player));
      if (closest.isPresent() && away > distance) {
        continue;
      }
      distance = away;
      closest = Optional.of(new Target(entity.orElseThrow(), member));
    }
    return closest;
  }

  /** Whether {@code key}'s recharge of {@code every} is over, starting it again if so. */
  private boolean ready(String key, Duration every) {
    var now = runner.now();
    var last = recharges.get(key);
    if (last != null && now.isBefore(last.plus(every))) {
      return false;
    }
    recharges.put(key, now);
    return true;
  }

  // ---- the clock ----------------------------------------------------------------------------

  /**
   * One tick of a live match: falling rewards, napalm and its fire, and every half second the
   * compass's stray and the crates' labels, every second the dogs.
   */
  void tick() {
    ticks++;
    for (var drop : List.copyOf(falling.values())) {
      var block = drop.block();
      if (!block.isValid()) {
        land(block, Places.at(block));
        continue;
      }
      if (drop.streak() == Killstreak.NAPALM) {
        block.setVelocity(new Vector(0, Delivery.NAPALM_FALL_SPEED, 0));
        if (ticks % Delivery.NAPALM_HISS_EVERY == 0) {
          block.getWorld().playSound(block.getLocation(), Sound.ENTITY_CAT_HISS, 2, 0);
        }
      }
    }
    napalm.tick(ticks);
    if (ticks % Delivery.HALF_SECOND_TICKS == 0) {
      var random = runner.match().random(runner.now());
      for (var axis = 0; axis < stray.length; axis++) {
        stray[axis] = Delivery.stray(stray[axis], random);
      }
      context.guarded("label the supply crates", crates::relabel);
    }
    if (ticks % Delivery.SECOND_TICKS == 0) {
      summons.tick();
    }
  }

  // ---- going --------------------------------------------------------------------------------

  /** The combatant embodied by {@code owner} died or left: their dogs go with them. */
  void dismiss(UUID owner) {
    summons.dismiss(owner);
  }

  /** The match reset: everything the rewards put in the world goes. */
  void reset() {
    falling.values().forEach(drop -> drop.block().remove());
    falling.clear();
    crates.reset();
    napalm.reset();
    blocks.reset();
    summons.clear();
    recharges.clear();
    Arrays.fill(stray, 0);
  }

  /** Whether a crate stands at {@code at}, for tests. */
  boolean hasCrate(BlockPos at) {
    return crates.has(at);
  }
}
