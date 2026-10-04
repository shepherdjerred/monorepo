package com.shepherdjerred.thestorm.rwf.adapter.content;

import com.shepherdjerred.thestorm.rwf.domain.bomb.FuseBonus;
import com.shepherdjerred.thestorm.rwf.domain.bomb.FuseType;
import com.shepherdjerred.thestorm.rwf.domain.kit.ArmorSlot;
import com.shepherdjerred.thestorm.rwf.domain.kit.ItemSpec;
import com.shepherdjerred.thestorm.rwf.domain.kit.KitAvailability;
import com.shepherdjerred.thestorm.rwf.domain.kit.KitSpec;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * {@code rwf/kits.yml}: the kits as the operator sees them. The kits themselves are code ({@code
 * KitBook}); this file must agree with it exactly, so a change to either is visible in the other.
 *
 * @param kits every kit, in menu order
 */
public record KitsFile(List<KitEntry> kits) {

  public KitsFile {
    kits = List.copyOf(kits);
  }

  /** The kits as domain specs. */
  public List<KitSpec> toSpecs() {
    return kits.stream().map(KitEntry::toSpec).toList();
  }

  /** Throws unless this file describes exactly {@code book}, kit for kit. */
  public void mustMatch(List<KitSpec> book) {
    var specs = toSpecs();
    var ids = specs.stream().map(KitSpec::id).toList();
    var expected = book.stream().map(KitSpec::id).toList();
    if (!ids.equals(expected)) {
      throw new IllegalStateException(
          "kits.yml lists " + ids + " but the kit book has " + expected);
    }
    for (var i = 0; i < specs.size(); i++) {
      if (!specs.get(i).equals(book.get(i))) {
        throw new IllegalStateException(
            "kits.yml describes kit " + ids.get(i) + " differently from the kit book");
      }
    }
  }

  /**
   * One kit.
   *
   * @param id the kit id
   * @param name the display name
   * @param description the kit menu text
   * @param price credits to buy it; 0 for free kits
   * @param availability who may pick it
   * @param fuseBonus the bonus on the kit's Bomb Fuse, or null
   * @param hotbar the items after the fuse, in slot order
   * @param armor the armor worn
   * @param ability the pure ability id, or null
   */
  public record KitEntry(
      String id,
      String name,
      String description,
      int price,
      KitAvailability availability,
      Optional<FuseEntry> fuseBonus,
      List<ItemEntry> hotbar,
      List<ArmorEntry> armor,
      Optional<String> ability) {

    public KitEntry {
      hotbar = List.copyOf(hotbar);
      armor = List.copyOf(armor);
      // Compact constructors run before the fields exist: validate from the parameters.
      var _ =
          new KitSpec(
              id,
              name,
              description,
              price,
              availability,
              fuseBonus.map(FuseEntry::toBonus),
              hotbar.stream().map(ItemEntry::toSpec).toList(),
              armor.stream().map(ArmorEntry::toSpec).toList(),
              ability);
    }

    KitSpec toSpec() {
      return new KitSpec(
          id,
          name,
          description,
          price,
          availability,
          fuseBonus.map(FuseEntry::toBonus),
          hotbar.stream().map(ItemEntry::toSpec).toList(),
          armor.stream().map(ArmorEntry::toSpec).toList(),
          ability);
    }
  }

  /**
   * A fuse bonus.
   *
   * @param type what it speeds up
   * @param level seconds taken off, 1 to 10
   */
  public record FuseEntry(FuseType type, int level) {

    public FuseEntry {
      var _ = new FuseBonus(type, level);
    }

    FuseBonus toBonus() {
      return new FuseBonus(type, level);
    }
  }

  /**
   * A hotbar item.
   *
   * @param material the material, such as {@code IRON_SWORD}
   * @param amount how many
   * @param name a display name, or null
   * @param enchantments enchantment key to level
   */
  public record ItemEntry(
      String material, int amount, Optional<String> name, Map<String, Integer> enchantments) {

    public ItemEntry {
      enchantments = Map.copyOf(enchantments);
      var _ = new ItemSpec(material, amount, name, enchantments, Optional.empty());
    }

    ItemSpec toSpec() {
      return new ItemSpec(material, amount, name, enchantments, Optional.empty());
    }
  }

  /**
   * A piece of armor.
   *
   * @param material the material, such as {@code IRON_HELMET}
   * @param slot where it is worn
   * @param enchantments enchantment key to level
   */
  public record ArmorEntry(String material, ArmorSlot slot, Map<String, Integer> enchantments) {

    public ArmorEntry {
      enchantments = Map.copyOf(enchantments);
      var _ = new ItemSpec(material, 1, Optional.empty(), enchantments, Optional.of(slot));
    }

    ItemSpec toSpec() {
      return new ItemSpec(material, 1, Optional.empty(), enchantments, Optional.of(slot));
    }
  }
}
