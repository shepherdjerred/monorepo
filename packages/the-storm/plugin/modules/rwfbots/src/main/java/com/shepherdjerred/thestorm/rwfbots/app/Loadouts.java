package com.shepherdjerred.thestorm.rwfbots.app;

import com.shepherdjerred.thestorm.rwf.app.view.KitHotbar;
import com.shepherdjerred.thestorm.rwf.app.view.WeaponProfile;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.Loadout;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.Weapon;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.Set;
import java.util.function.Predicate;

/**
 * Where an rwf kit puts its items, read from rwf's own kit list so a bot reaches for the slot a
 * player's hotbar has: the Bomb Fuse locked in slot 0, then the kit's items in its order. The melee
 * weapon is the first sword or axe (a Wraith, which carries none, swings its bow).
 */
public final class Loadouts {

  /** The hotbar slot rwf locks the Bomb Fuse into. */
  public static final int FUSE_SLOT = 0;

  private static final Set<String> BOWS = Set.of("BOW", "CROSSBOW", "TRIDENT");

  private Loadouts() {}

  public static Loadout rwf(Kit kit) {
    var id = kit.name().toLowerCase(Locale.ROOT);
    var hotbar =
        KitHotbar.of(id)
            .orElseThrow(() -> new IllegalArgumentException("rwf has no kit " + id))
            .slots();
    var weapon =
        slot(hotbar, Loadouts::weapon)
            .or(() -> hotbar.stream().map(KitHotbar.Slot::slot).findFirst())
            .orElseThrow(() -> new IllegalArgumentException(id + " carries nothing to swing"));
    var items = new ArrayList<Loadout.KitItem>();
    for (var move : kit.moves()) {
      var slot =
          slot(hotbar, move.item()::equals)
              .orElseThrow(() -> new IllegalArgumentException(id + " carries no " + move.item()));
      items.add(new Loadout.KitItem(move, slot));
    }
    return new Loadout(
        weapon,
        slot(hotbar, BOWS::contains).orElse(-1),
        slot(hotbar, "GOLDEN_APPLE"::equals).orElse(-1),
        FUSE_SLOT,
        items,
        kit.body(),
        hotbar.stream()
            .filter(item -> item.slot() == weapon)
            .map(item -> profile(item.weapon()))
            .findFirst()
            .orElseThrow(),
        hotbar.stream()
            .filter(item -> BOWS.contains(item.material()))
            .map(item -> profile(item.weapon()))
            .findFirst()
            .orElse(Weapon.NONE));
  }

  private static Weapon profile(WeaponProfile profile) {
    return new Weapon(
        Weapon.Kind.valueOf(profile.kind().name()),
        profile.minReach(),
        profile.maxReach(),
        profile.chargeTicks(),
        profile.projectileSpeed());
  }

  private static boolean weapon(String material) {
    return material.endsWith("_SWORD")
        || material.endsWith("_AXE")
        || material.endsWith("_SPEAR")
        || material.equals("TRIDENT")
        || material.equals("MACE");
  }

  private static Optional<Integer> slot(List<KitHotbar.Slot> hotbar, Predicate<String> material) {
    return hotbar.stream()
        .filter(slot -> material.test(slot.material()))
        .map(KitHotbar.Slot::slot)
        .findFirst();
  }
}
