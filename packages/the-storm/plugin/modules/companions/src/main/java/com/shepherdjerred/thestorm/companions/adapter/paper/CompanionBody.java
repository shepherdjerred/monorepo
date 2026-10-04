package com.shepherdjerred.thestorm.companions.adapter.paper;

import static java.util.Objects.requireNonNull;

import com.shepherdjerred.thestorm.companions.app.CompanionState;
import com.shepherdjerred.thestorm.companions.domain.CompanionsConfig.Identity;
import java.util.Base64;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.StreamSupport;
import net.citizensnpcs.api.CitizensAPI;
import net.citizensnpcs.api.npc.NPC;
import net.citizensnpcs.trait.SkinTrait;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.Server;
import org.bukkit.entity.EntityType;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;

/** Citizens is the avatar; the Storm snapshot remains authoritative for survival state. */
final class CompanionBody {
  static final String OWNER = "thestorm-companion-id";

  private CompanionBody() {}

  static NPC obtain(Identity identity, Optional<UUID> saved) {
    var registry = CitizensAPI.getNPCRegistry();
    var existing = saved.map(registry::getByUniqueId);
    NPC npc;
    if (existing.isPresent()) {
      npc = existing.get();
      if (!identity.id().equals(npc.data().get(OWNER)))
        throw new IllegalStateException("companion identity does not match Citizens state");
    } else if (saved.isPresent()) {
      var next =
          StreamSupport.stream(registry.spliterator(), false).mapToInt(NPC::getId).max().orElse(-1)
              + 1;
      npc = registry.createNPC(EntityType.PLAYER, saved.get(), next, identity.name() + " [NPC]");
    } else {
      for (var candidate : registry) {
        if (identity.id().equals(candidate.data().get(OWNER)))
          throw new IllegalStateException(
              "Citizens companion exists without its survival snapshot");
      }
      npc = registry.createNPC(EntityType.PLAYER, identity.name() + " [NPC]");
    }
    configure(npc, identity);
    return npc;
  }

  private static void configure(NPC npc, Identity identity) {
    npc.data().setPersistent(OWNER, identity.id());
    npc.setProtected(false);
    npc.data().setPersistent(NPC.Metadata.REMOVE_FROM_PLAYERLIST, true);
    npc.data().setPersistent(NPC.Metadata.REMOVE_FROM_TABLIST, false);
    npc.data().setPersistent(NPC.Metadata.PICKUP_ITEMS, false);
    npc.data().setPersistent(NPC.Metadata.DROPS_ITEMS, true);
    npc.data().setPersistent(NPC.Metadata.RESPAWN_DELAY, -1);
    npc.data().setPersistent(NPC.Metadata.DISABLE_DEFAULT_STUCK_ACTION, true);
    npc.getNavigator()
        .getDefaultParameters()
        .speedModifier(1)
        .range(32)
        .distanceMargin(0.5)
        .stationaryTicks(60)
        .stuckAction((ignored, navigator) -> false);
    var skin = npc.getOrAddTrait(SkinTrait.class);
    skin.setFetchDefaultSkin(false);
    skin.setShouldUpdateSkins(false);
  }

  static Player player(NPC npc) {
    if (!(npc.getEntity() instanceof Player player))
      throw new IllegalStateException("companion does not have a player body");
    return player;
  }

  static void restore(NPC npc, CompanionState state, Server server) {
    var spot = state.position();
    var world = server.getWorld(spot.world());
    if (world == null)
      throw new IllegalStateException("saved companion world is not loaded: " + spot.world());
    var destination = new Location(world, spot.x(), spot.y(), spot.z(), spot.yaw(), spot.pitch());
    if (!world.isChunkLoaded(destination.getBlockX() >> 4, destination.getBlockZ() >> 4))
      throw new IllegalStateException("load companion chunk asynchronously before spawning");
    if (npc.isSpawned()) npc.despawn();
    if (!npc.spawn(destination)) throw new IllegalStateException("Citizens companion spawn failed");
    var player = player(npc);
    player.setGameMode(GameMode.SURVIVAL);
    player.addScoreboardTag("storm_companion");
    player.setSleepingIgnored(true);
    player.setCanPickupItems(false);
    player.setInvulnerable(false);
    var contents =
        ItemStack.deserializeItemsFromBytes(Base64.getDecoder().decode(state.inventory()));
    var expectedSize = requireNonNull(player.getInventory().getContents()).length;
    if (contents.length != expectedSize)
      throw new IllegalStateException(
          "companion inventory slots "
              + contents.length
              + " differ from Paper contents "
              + expectedSize);
    player.getInventory().setContents(contents);
    player.setHealth(state.vitals().health());
    player.setFoodLevel(state.vitals().food());
    player.setSaturation(state.vitals().saturation());
    player.setLevel(state.vitals().level());
    player.setExp(state.vitals().experience());
  }

  static CompanionState snapshot(NPC npc, Optional<CompanionState.Building> building) {
    return snapshot(npc.getUniqueId(), player(npc), building);
  }

  static CompanionState snapshot(
      UUID identity, Player player, Optional<CompanionState.Building> building) {
    var at = requireNonNull(player.getLocation());
    return new CompanionState(
        identity,
        new CompanionState.Position(
            at.getWorld().getName(), at.getX(), at.getY(), at.getZ(), at.getYaw(), at.getPitch()),
        new CompanionState.Vitals(
            player.getHealth(),
            player.getFoodLevel(),
            player.getSaturation(),
            player.getLevel(),
            player.getExp()),
        Base64.getEncoder()
            .encodeToString(
                ItemStack.serializeItemsAsBytes(
                    requireNonNull(player.getInventory().getContents()))),
        building);
  }

  static CompanionState initial(
      NPC npc,
      Location at,
      com.shepherdjerred.thestorm.essentials.app.StarterSupplies supplies,
      Server server) {
    var human =
        server.getOnlinePlayers().stream()
            .filter(com.shepherdjerred.thestorm.core.players.Humans::isHuman)
            .findFirst()
            .orElseThrow();
    var items = new ItemStack[requireNonNull(human.getInventory().getContents()).length];
    for (var index = 0; index < supplies.items().size(); index++)
      items[index] =
          ItemStack.deserializeBytes(Base64.getDecoder().decode(supplies.items().get(index)));
    return new CompanionState(
        npc.getUniqueId(),
        new CompanionState.Position(
            at.getWorld().getName(), at.getX(), at.getY(), at.getZ(), at.getYaw(), at.getPitch()),
        new CompanionState.Vitals(20, 20, 5, 0, 0),
        Base64.getEncoder().encodeToString(ItemStack.serializeItemsAsBytes(items)),
        Optional.empty());
  }
}
