package com.shepherdjerred.thestorm.towns.adapter.paper;

import com.shepherdjerred.thestorm.towns.domain.protection.Act;
import com.shepherdjerred.thestorm.towns.domain.protection.Action;
import com.shepherdjerred.thestorm.towns.domain.protection.Subject;
import com.shepherdjerred.thestorm.towns.domain.protection.Victim;
import java.util.Optional;
import java.util.UUID;
import org.bukkit.entity.AbstractVillager;
import org.bukkit.entity.ArmorStand;
import org.bukkit.entity.EnderCrystal;
import org.bukkit.entity.Enemy;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Hanging;
import org.bukkit.entity.ItemFrame;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Mannequin;
import org.bukkit.entity.Player;
import org.bukkit.entity.Tameable;
import org.bukkit.entity.Vehicle;
import org.bukkit.inventory.InventoryHolder;

/**
 * Which entities land protection covers. Players (PvP has its own rule), hostile mobs, NPC
 * mannequins and technical entities (items, projectiles, displays, interaction boxes) are not
 * protected; animals, villagers, golems, vehicles, item frames, paintings, armor stands and end
 * crystals are.
 */
final class EntityKinds {

  private EntityKinds() {}

  /** The subject of acting on {@code entity}, or empty when it is not protected. */
  static Optional<Subject> subject(Entity entity) {
    return switch (entity) {
      case Player _, Enemy _, Mannequin _ -> Optional.empty();
      case ItemFrame _ -> Optional.of(Subject.ITEM_FRAME);
      case ArmorStand _ -> Optional.of(Subject.ARMOR_STAND);
      case AbstractVillager _ -> Optional.of(Subject.VILLAGER);
      case LivingEntity _ -> Optional.of(Subject.ANIMAL);
      case Vehicle _ -> Optional.of(Subject.VEHICLE);
      case Hanging _, EnderCrystal _ -> Optional.of(Subject.ENTITY);
      default -> Optional.empty();
    };
  }

  /** What right-clicking {@code entity} does, or empty when it is not protected. */
  static Optional<Act> use(Entity entity) {
    return subject(entity)
        .map(
            subject ->
                subject == Subject.VEHICLE && entity instanceof InventoryHolder
                    ? new Act(Action.OPEN_CONTAINER, Subject.CONTAINER)
                    : new Act(Action.INTERACT_ENTITY, subject));
  }

  /** What {@code entity} is to {@code attacker} when they hurt, push or pull it. */
  static Victim victim(Entity entity, UUID attacker) {
    if (entity.getUniqueId().equals(attacker)) {
      return new Victim.Self();
    }
    if (entity instanceof Player) {
      return new Victim.OtherPlayer();
    }
    if (entity instanceof Tameable pet && pet.isTamed() && pet.getOwnerUniqueId() != null) {
      return attacker.equals(pet.getOwnerUniqueId()) ? new Victim.OwnPet() : new Victim.OthersPet();
    }
    return subject(entity).<Victim>map(Victim.Protected::new).orElseGet(Victim.Unprotected::new);
  }

  /** True when {@code player} tamed {@code entity}: owners may always use and hurt their pets. */
  static boolean isPetOf(Entity entity, UUID player) {
    return entity instanceof Tameable pet && player.equals(pet.getOwnerUniqueId());
  }
}
