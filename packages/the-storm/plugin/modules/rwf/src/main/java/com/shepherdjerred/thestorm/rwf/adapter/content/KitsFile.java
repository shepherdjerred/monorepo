package com.shepherdjerred.thestorm.rwf.adapter.content;

import com.shepherdjerred.thestorm.rwf.domain.bomb.FuseBonus;
import com.shepherdjerred.thestorm.rwf.domain.bomb.FuseType;
import com.shepherdjerred.thestorm.rwf.domain.kit.ArmorSlot;
import com.shepherdjerred.thestorm.rwf.domain.kit.ItemLook;
import com.shepherdjerred.thestorm.rwf.domain.kit.ItemSpec;
import com.shepherdjerred.thestorm.rwf.domain.kit.KitAvailability;
import com.shepherdjerred.thestorm.rwf.domain.kit.KitSpec;
import com.shepherdjerred.thestorm.rwf.domain.kit.KitTier;
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
   * @param tier how involved it is to play
   * @param availability who may pick it
   * @param fuseBonus the bonus on the kit's Bomb Fuse, or null
   * @param hotbar the items after the fuse, in slot order
   * @param armor the armor worn
   * @param ability the pure ability id, or null
   * @param icon the material of the kit's menu icon and lobby alcove item
   * @param iconTint the icon's colour as #RRGGBB, or null
   * @param summary one to four short lore lines shown on the icon and the alcove
   */
  public record KitEntry(
      String id,
      String name,
      String description,
      int price,
      KitTier tier,
      KitAvailability availability,
      Optional<FuseEntry> fuseBonus,
      List<ItemEntry> hotbar,
      List<ArmorEntry> armor,
      Optional<String> ability,
      String icon,
      Optional<String> iconTint,
      List<String> summary) {

    public KitEntry {
      hotbar = List.copyOf(hotbar);
      armor = List.copyOf(armor);
      summary = List.copyOf(summary);
      // Compact constructors run before the fields exist: validate from the parameters.
      var _ =
          new KitSpec(
              id,
              name,
              description,
              price,
              tier,
              availability,
              fuseBonus.map(FuseEntry::toBonus),
              hotbar.stream().map(ItemEntry::toSpec).toList(),
              armor.stream().map(ArmorEntry::toSpec).toList(),
              ability,
              new KitSpec.Menu(icon, iconTint, summary));
    }

    KitSpec toSpec() {
      return new KitSpec(
          id,
          name,
          description,
          price,
          tier,
          availability,
          fuseBonus.map(FuseEntry::toBonus),
          hotbar.stream().map(ItemEntry::toSpec).toList(),
          armor.stream().map(ArmorEntry::toSpec).toList(),
          ability,
          new KitSpec.Menu(icon, iconTint, summary));
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
   * @param look its colours, lore and glint, or null for a plain item
   */
  public record ItemEntry(
      String material,
      int amount,
      Optional<String> name,
      Map<String, Integer> enchantments,
      Optional<LookEntry> look) {

    public ItemEntry {
      enchantments = Map.copyOf(enchantments);
      var _ = plain(material, amount, name, enchantments);
    }

    ItemSpec toSpec() {
      return plain(material, amount, name, enchantments)
          .withLook(look.map(LookEntry::toLook).orElse(ItemLook.PLAIN));
    }

    private static ItemSpec plain(
        String material, int amount, Optional<String> name, Map<String, Integer> enchantments) {
      return new ItemSpec(material, amount, name, enchantments, Optional.empty(), ItemLook.PLAIN);
    }
  }

  /**
   * How an item looks.
   *
   * @param nameColor the name's chat colour, such as gold, or null
   * @param lore lines under the name
   * @param loreColor the lore's chat colour, or null when there is no lore
   * @param glint whether it shimmers as if enchanted
   * @param dye a #RRGGBB colour or team, or null
   */
  public record LookEntry(
      Optional<String> nameColor,
      List<String> lore,
      Optional<String> loreColor,
      boolean glint,
      Optional<String> dye) {

    public LookEntry {
      lore = List.copyOf(lore);
      var _ = new ItemLook(nameColor, lore, loreColor, glint, dye);
    }

    ItemLook toLook() {
      return new ItemLook(nameColor, lore, loreColor, glint, dye);
    }
  }

  /**
   * A piece of armor.
   *
   * @param material the material, such as {@code IRON_HELMET}
   * @param slot where it is worn
   * @param enchantments enchantment key to level
   * @param dye a leather colour as #RRGGBB, or null
   */
  public record ArmorEntry(
      String material, ArmorSlot slot, Map<String, Integer> enchantments, Optional<String> dye) {

    public ArmorEntry {
      enchantments = Map.copyOf(enchantments);
      var _ = toSpec(material, slot, enchantments, dye);
    }

    ItemSpec toSpec() {
      return toSpec(material, slot, enchantments, dye);
    }

    private static ItemSpec toSpec(
        String material, ArmorSlot slot, Map<String, Integer> enchantments, Optional<String> dye) {
      var spec =
          new ItemSpec(
              material, 1, Optional.empty(), enchantments, Optional.of(slot), ItemLook.PLAIN);
      return dye.map(spec::dyed).orElse(spec);
    }
  }
}
