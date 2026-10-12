package com.shepherdjerred.thestorm.rwf.domain.ability;

import static com.shepherdjerred.thestorm.rwf.testing.Samples.ALICE;
import static com.shepherdjerred.thestorm.rwf.testing.Samples.BOB;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Berserker;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Bleeder;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Equality;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Frost;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Juggernaut;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Medic;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Vampire;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Venom;
import com.shepherdjerred.thestorm.rwf.domain.ability.kits.Warper;
import com.shepherdjerred.thestorm.rwf.domain.combat.AttackType;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Vec3;
import com.shepherdjerred.thestorm.rwf.domain.kit.ArmorSlot;
import com.shepherdjerred.thestorm.rwf.domain.kit.ItemSpec;
import com.shepherdjerred.thestorm.rwf.domain.kit.KitBook;
import com.shepherdjerred.thestorm.rwf.domain.kit.KitSpec;
import com.shepherdjerred.thestorm.rwf.domain.kit.LoreLines;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

/**
 * Pins batch A's kits to libraryaddict's Red Warfare, line for line: SnDKit's fuse and layout,
 * Trooper, Longbow, Shortbow, Ninja, Pyro, Venom, Juggernaut, Berserker, Equality, Vampire,
 * Bleeder, Medic, Frost and Warper. Every number, name and message here is copied from the
 * original's kits and abilities; a change to one is a change away from Red Warfare.
 */
final class OriginalKitsATest {

  /** The original's description array, joined as KitBook keeps it. */
  private static String lines(String... lines) {
    return String.join("\n", lines);
  }

  @Nested
  final class Descriptions {

    @Test
    void everyDescriptionIsTheOriginalsWordForWord() {
      assertThat(KitBook.TROOPER.description())
          .isEqualTo(
              "The kit that sets the standards for all others. It receives a set of iron armor and"
                  + " an iron sword, along with five golden apples with which it can quickly recover"
                  + " from fights.");
      assertThat(KitBook.LONGBOW.description())
          .isEqualTo("A supporting archer, this kit receives a bow that will send enemies flying.");
      assertThat(KitBook.SHORTBOW.description())
          .isEqualTo(
              "A powerful archer, this kit receives a bow with which it deals precise damage.");
      assertThat(KitBook.NINJA.description())
          .isEqualTo(
              lines(
                  "The ninja starts with enderpearls and can sprint about the map with a speed"
                      + " boost",
                  "He is known as one who can outrun the stronger warriors",
                  "With fall protection, he's not afraid of heights!"));
      assertThat(KitBook.PYRO.description())
          .isEqualTo(
              "A master of fire, this kit is given a flaming bow and sword, and fire resistant"
                  + " leather armor.");
      assertThat(KitBook.VENOM.description())
          .isEqualTo(
              "An offensive kit that excels at hit and runs. Its blade is coated in deadly poison"
                  + " and paralyzer, making every hit it lands poison its foe and slow them down!");
      assertThat(KitBook.JUGGERNAUT.description())
          .isEqualTo(
              lines(
                  "A defensive kit that will only take a fraction of the normal melee and ranged"
                      + " damage it would normally take with an extra 5 hearts!",
                  "Juggernauts however will still suffer from the damage it would normally take"
                      + " from other sources, such as fall.",
                  "Additionally, due to its heavy armor, it's hard to knock a juggernaut back.",
                  "This comes at great cost to its mobility, as it cannot sprint."));
      assertThat(KitBook.BERSERKER.description())
          .isEqualTo(
              "An offensive kit with a powerful axe and low armor. Its damage increases by half a"
                  + " heart every kill as it works up a bloodlust.");
      assertThat(KitBook.EQUALITY.description())
          .isEqualTo(
              "You will always take 3 damage, you will always deal 3 damage. You were born equal"
                  + " and you will die equal.");
      assertThat(KitBook.VAMPIRE.description())
          .isEqualTo(
              "A kit that must pick its early kills carefully, as it only starts with 8 hearts."
                  + " However, every kill grants it a vital reward of 2 hearts, with a maximum of"
                  + " 20.");
      assertThat(KitBook.BLEEDER.description())
          .isEqualTo(
              "One of the most feared kits, the bleeder can permanently destroy the health of his"
                  + " foes with every blow");
      assertThat(KitBook.MEDIC.description())
          .isEqualTo(
              lines(
                  "This supportive kit can heal allies with its wand, but it has a limit of 25"
                      + " hearts per player.",
                  "After that, they can only heal minorly by giving regeneration.",
                  "To heal more efficiently, medics can see the overall health of every player over"
                      + " their heads.",
                  "",
                  "§4§lThis kit loses its healing ability in small games with less than 20"
                      + " players"));
      assertThat(KitBook.FROST.description())
          .isEqualTo(
              lines(
                  "Master of ice and frost, this special guy can freeze the hands of your enemies"
                      + " for 10 seconds!",
                  "When frozen, your enemies cannot switch items or use their offhand!"));
      assertThat(KitBook.WARPER.description())
          .isEqualTo(
              "A supportive kit, it has the ability to warp a group of enemies to where it was"
                  + " standing 10 seconds ago, making it useful against an otherwise strong"
                  + " defense.");
    }

    @Test
    void loreBreaksWhereRedWarfaresSplitLineBrokeIt() {
      var medic =
          LoreLines.of(
              Arrays.stream(KitBook.MEDIC.description().split("\n", -1))
                  .map(line -> "§e" + line)
                  .toList());

      // Worked through Red Warfare's splitLine by hand: a space counts as four.
      assertThat(medic)
          .containsExactly(
              "§eThis supportive kit can heal",
              "§eallies with its wand, but",
              "§eit has a limit of 25",
              "§ehearts per player.",
              "§e§eAfter that, they can only",
              "§eheal minorly by giving",
              "§eregeneration.",
              "§e§eTo heal more efficiently,",
              "§emedics can see the overall",
              "§ehealth of every player over",
              "§etheir heads.",
              "§e§e",
              "§e§e§4§lThis kit loses its",
              "§4§lhealing ability in small",
              "§4§lgames with less than",
              "§4§l20 players");
      assertThat(LoreLines.of(List.of("§d§lRIGHT CLICK BOMB TO ARM AND DISARM")))
          .containsExactly("§d§lRIGHT CLICK BOMB TO", "§d§lARM AND DISARM");
      assertThat(LoreLines.of(List.of("§4§lLOCKED §bPurchase for 300 credits")))
          .containsExactly("§4§lLOCKED §bPurchase for 300", "§bcredits");
      assertThat(LoreLines.lastColors("§4§lLOCKED §bPurchase")).isEqualTo("§b");
      assertThat(LoreLines.lastColors("§e§4§lText")).isEqualTo("§4§l");
    }

    @Test
    void theMenuOrderIsSearchAndDestroysThenTheKitsItNeverOffered() {
      assertThat(KitBook.ALL.subList(0, 22).stream().map(KitSpec::id))
          .containsExactly(
              "trooper",
              "berserker",
              "demolitions",
              "dwarf",
              "explosive",
              "ghost",
              "juggernaut",
              "longbow",
              "medic",
              "pyro",
              "rewind",
              "shortbow",
              "spy",
              "teleporter",
              "vampire",
              "venom",
              "warper",
              "ninja",
              "frost",
              "skinner",
              "wraith",
              "bleeder");
    }
  }

  @Nested
  final class Items {

    @Test
    void theFuseIsGoldWithLightPurpleBoldLore() {
      assertThat(KitSpec.FUSE.material()).isEqualTo("BLAZE_POWDER");
      assertThat(KitSpec.FUSE.name()).contains("Bomb Fuse");
      assertThat(KitSpec.FUSE.look().nameColor()).contains("gold");
      assertThat(KitSpec.FUSE.look().loreColor()).contains("light_purple");
      assertThat(KitSpec.FUSE.look().lore())
          .containsExactly("§lRIGHT CLICK BOMB TO ARM AND DISARM");
    }

    @Test
    void theHotbarsAreTheOriginals() {
      assertThat(KitBook.TROOPER.hotbar())
          .containsExactly(
              ItemSpec.of("IRON_SWORD").enchanted("sharpness", 1), ItemSpec.of("GOLDEN_APPLE", 3));
      assertThat(KitBook.LONGBOW.hotbar())
          .containsExactly(
              ItemSpec.of("STONE_SWORD"),
              ItemSpec.of("BOW").enchanted("infinity", 1).enchanted("punch", 3),
              ItemSpec.of("ARROW"));
      assertThat(KitBook.SHORTBOW.hotbar())
          .containsExactly(
              ItemSpec.of("WOODEN_SWORD").enchanted("knockback", 1),
              ItemSpec.of("BOW").enchanted("infinity", 1).enchanted("power", 2),
              ItemSpec.of("ARROW"));
      assertThat(KitBook.NINJA.hotbar())
          .containsExactly(ItemSpec.of("IRON_SWORD"), ItemSpec.of("ENDER_PEARL", 6));
      assertThat(KitBook.BERSERKER.hotbar())
          .containsExactly(
              ItemSpec.of("IRON_AXE").enchanted("sharpness", 2), ItemSpec.of("COOKED_BEEF", 2));
      assertThat(KitBook.JUGGERNAUT.hotbar()).containsExactly(ItemSpec.of("STONE_SWORD"));
      assertThat(KitBook.EQUALITY.hotbar()).containsExactly(ItemSpec.of("IRON_SWORD"));
      assertThat(KitBook.FROST.hotbar()).containsExactly(ItemSpec.of("IRON_SWORD"));
      assertThat(KitBook.MEDIC.hotbar())
          .containsExactly(
              ItemSpec.of("IRON_SWORD"),
              ItemSpec.of("BLAZE_ROD").named("", "gold"),
              ItemSpec.of("GOLDEN_APPLE", 20));
      assertThat(KitBook.WARPER.hotbar())
          .containsExactly(
              ItemSpec.of("IRON_SWORD").enchanted("sharpness", 1),
              ItemSpec.of("BLAZE_ROD").named("Warper's Wand", "gold"));
      assertThat(KitBook.VAMPIRE.hotbar())
          .containsExactly(
              ItemSpec.of("IRON_SWORD").named("Vampiric Sword", "red").enchanted("sharpness", 1));
      assertThat(KitBook.BLEEDER.hotbar())
          .containsExactly(ItemSpec.of("WOODEN_SWORD").named("The Bleeder", "dark_red"));
      assertThat(KitBook.VENOM.hotbar())
          .containsExactly(
              ItemSpec.of("IRON_SWORD")
                  .named("Poisoned Sword", "dark_green")
                  .glinting()
                  .lore("gray", "", "Venom I"));
      assertThat(KitBook.PYRO.hotbar())
          .containsExactly(
              ItemSpec.of("IRON_SWORD").enchanted("fire_aspect", 2).named("Molten Sword", "red"),
              ItemSpec.of("BOW")
                  .enchanted("flame", 2)
                  .enchanted("infinity", 1)
                  .named("Charred Bow", "red"),
              ItemSpec.of("ARROW"));
    }

    @Test
    void theArrowGoesToSlotNineAndEverythingElseFollowsTheFuse() {
      assertThat(KitBook.LONGBOW.layout())
          .extracting(KitSpec.Placement::slot)
          .containsExactly(0, 1, 2, KitSpec.ARROW_SLOT);
      assertThat(KitBook.MEDIC.layout())
          .extracting(KitSpec.Placement::slot)
          .containsExactly(0, 1, 2, 3);
    }

    @Test
    void theArmourIsTheOriginals() {
      assertThat(KitBook.BERSERKER.armor())
          .extracting(ItemSpec::material)
          .containsExactly("IRON_BOOTS", "IRON_CHESTPLATE", "IRON_HELMET");
      assertThat(KitBook.JUGGERNAUT.armor())
          .extracting(ItemSpec::material)
          .containsExactly("IRON_BOOTS", "IRON_LEGGINGS", "DIAMOND_CHESTPLATE", "IRON_HELMET");
      assertThat(KitBook.VENOM.armor())
          .extracting(ItemSpec::material)
          .containsExactly("IRON_BOOTS", "IRON_LEGGINGS", "GOLDEN_CHESTPLATE", "CHAINMAIL_HELMET");
      assertThat(KitBook.LONGBOW.armor())
          .extracting(ItemSpec::material)
          .containsExactly(
              "CHAINMAIL_BOOTS", "IRON_LEGGINGS", "IRON_CHESTPLATE", "CHAINMAIL_HELMET");
      assertThat(KitBook.MEDIC.armor())
          .extracting(ItemSpec::material)
          .containsExactly("GOLDEN_BOOTS", "GOLDEN_LEGGINGS", "GOLDEN_CHESTPLATE", "GOLDEN_HELMET");
      assertThat(KitBook.BLEEDER.armor())
          .extracting(ItemSpec::material)
          .containsExactly(
              "CHAINMAIL_BOOTS", "CHAINMAIL_LEGGINGS", "CHAINMAIL_CHESTPLATE", "CHAINMAIL_HELMET");
      assertThat(KitBook.NINJA.armor().getFirst())
          .isEqualTo(
              ItemSpec.armor("CHAINMAIL_BOOTS", ArmorSlot.BOOTS).enchanted("feather_falling", 2));
      assertThat(KitBook.FROST.armor())
          .allMatch(piece -> piece.look().dye().filter("#00FFFF"::equals).isPresent());
      assertThat(KitBook.EQUALITY.armor())
          .extracting(piece -> piece.look().dye().orElseThrow())
          .containsExactly("#FFFFFF", "#000000", "#FFFFFF", "#000000");
      assertThat(KitBook.PYRO.armor())
          .allMatch(
              piece ->
                  piece.enchantmentLevel("fire_protection") == 1
                      && piece.enchantmentLevel("blast_protection") == 2
                      && piece.enchantmentLevel("projectile_protection") == 1);
    }

    @Test
    void pricesAndIconsAreTheOriginals() {
      assertThat(
              List.of(
                  KitBook.TROOPER.price(),
                  KitBook.LONGBOW.price(),
                  KitBook.SHORTBOW.price(),
                  KitBook.MEDIC.price(),
                  KitBook.NINJA.price(),
                  KitBook.PYRO.price(),
                  KitBook.VENOM.price(),
                  KitBook.JUGGERNAUT.price(),
                  KitBook.BERSERKER.price(),
                  KitBook.EQUALITY.price(),
                  KitBook.VAMPIRE.price(),
                  KitBook.BLEEDER.price(),
                  KitBook.FROST.price(),
                  KitBook.WARPER.price()))
          .containsExactly(0, 0, 0, 0, 200, 200, 400, 350, 400, 350, 300, 400, 150, 250);
      assertThat(
              List.of(
                  KitBook.TROOPER.menu().icon(),
                  KitBook.NINJA.menu().icon(),
                  KitBook.PYRO.menu().icon(),
                  KitBook.JUGGERNAUT.menu().icon(),
                  KitBook.BERSERKER.menu().icon(),
                  KitBook.EQUALITY.menu().icon(),
                  KitBook.VAMPIRE.menu().icon(),
                  KitBook.BLEEDER.menu().icon(),
                  KitBook.MEDIC.menu().icon(),
                  KitBook.FROST.menu().icon(),
                  KitBook.WARPER.menu().icon()))
          .containsExactly(
              "IRON_SWORD",
              "ENDER_PEARL",
              "FLINT_AND_STEEL",
              "DIAMOND_CHESTPLATE",
              "DIAMOND_AXE",
              "SMOOTH_STONE_SLAB",
              "RED_DYE",
              "WOODEN_SWORD",
              "GOLDEN_APPLE",
              "ICE",
              "BLAZE_ROD");
    }
  }

  @Nested
  final class Constants {

    @Test
    void theAbilitiesKeepTheOriginalsNumbers() {
      assertThat(Venom.TICKS).isEqualTo(120);
      assertThat(Juggernaut.MAX_HEALTH).isEqualTo(30);
      assertThat(Juggernaut.HIT_SHARE).isEqualTo(0.6);
      assertThat(Juggernaut.EXPLOSION_SHARE).isEqualTo(0.75);
      assertThat(Juggernaut.KNOCKBACK).isEqualTo(0.8);
      assertThat(Berserker.PER_KILL).isEqualTo(0.7);
      assertThat(Berserker.MOST).isEqualTo(7);
      assertThat(Equality.DAMAGE).isEqualTo(3);
      assertThat(Vampire.START).isEqualTo(16);
      assertThat(Vampire.MOST).isEqualTo(40);
      assertThat(Vampire.KILL_REGEN_TICKS).isEqualTo(300);
      assertThat(Vampire.ASSIST_REGEN_TICKS).isEqualTo(150);
      assertThat(Bleeder.BASE).isEqualTo(2);
      assertThat(Bleeder.SPREAD).isEqualTo(1);
      assertThat(Bleeder.FLOOR).isEqualTo(0.5);
      assertThat(Medic.SMALL_GAME).isEqualTo(20);
      assertThat(Medic.REACH).isEqualTo(5);
      assertThat(Medic.CROWD).isEqualTo(8);
      assertThat(Medic.LIMIT).isEqualTo(50);
      assertThat(Medic.PER_POINT.toMillis()).isEqualTo(300);
      assertThat(Medic.REGEN_TICKS).isEqualTo(50);
      assertThat(Medic.WARN_AFTER.toMillis()).isEqualTo(1000);
      assertThat(Frost.RECHARGE.toMillis()).isEqualTo(16_000);
      assertThat(Frost.FROZEN.toMillis()).isEqualTo(10_000);
      assertThat(Frost.PER_PIECE).isEqualTo(0.125);
      assertThat(Warper.WINDOW.toMillis()).isEqualTo(10_000);
      assertThat(Warper.RECHARGE.toMillis()).isEqualTo(30_000);
      assertThat(Warper.FIRST_RECHARGE.toMillis()).isEqualTo(10_000);
    }

    @Test
    void theMessagesAreTheOriginalsInTheirColours() {
      assertThat(Frost.FROZEN_MESSAGE).isEqualTo("§b§kab§b Your hands were covered in frost!");
      assertThat(Frost.OFFHAND_MESSAGE).isEqualTo("§b§kab§b Your weaker hand has been frozen!");
      assertThat(Frost.THAWED_MESSAGE).isEqualTo("§c§kab§c You thawed out");
    }
  }

  @Nested
  final class Rules {

    @Test
    void theMedicCountsPlayersOnlineAsTheMatchWentLiveNotFighters() {
      var crowded =
          new Bout().with(ALICE, TeamColor.RED, "medic").with(BOB, TeamColor.RED, "trooper");
      crowded.online = Medic.SMALL_GAME + 1;
      crowded.start();
      assertThat(
              crowded.act(
                  ALICE,
                  new AbilityInput.Heal(
                      List.of(new AbilityInput.Patient(BOB, 1, 10, 20, false, false)), 1, 20, 20)))
          .as("two fighters, but 21 players online: heals work")
          .contains(new AbilityEffect.Heal(BOB, 5));
    }

    @Test
    void aMedicWhoLivesToTheEndIsToldHowItDid() {
      var bout = new Bout().with(ALICE, TeamColor.RED, "medic");
      bout.start();

      assertThat(bout.end())
          .containsExactly(
              new AbilityEffect.Say(
                  List.of(ALICE),
                  "§6You need to improve your medic skills, heal more people!",
                  AbilityEffect.Tone.LEGACY));
    }

    @Test
    void aSpentWaveLeavesAStrongerRegenerationAlone() {
      var bout = new Bout().with(ALICE, TeamColor.RED, "medic").with(BOB, TeamColor.RED, "trooper");
      bout.start();
      bout.abilities =
          new Abilities(
              bout.abilities.states(),
              Map.of(Medic.ID, new Medic.Given(Map.of(BOB, Medic.LIMIT))),
              Map.of(),
              Map.of(),
              List.of(),
              2,
              bout.online);

      var effects =
          bout.act(
              ALICE,
              new AbilityInput.Heal(
                  List.of(new AbilityInput.Patient(BOB, 1, 10, 20, false, true)), 1, 20, 20));

      assertThat(effects).noneMatch(AbilityEffect.Potion.class::isInstance);
    }

    @Test
    void theVenomStacksItsPoisonOnTopOfWhatIsThere() {
      var bout =
          new Bout().with(ALICE, TeamColor.RED, "venom").with(BOB, TeamColor.BLUE, "trooper");
      bout.start();

      assertThat(bout.hit(ALICE, BOB, AttackType.MELEE, "IRON_SWORD"))
          .containsExactly(
              new AbilityEffect.PotionStack(BOB, "poison", 0, 120, Optional.of(ALICE)),
              new AbilityEffect.PotionStack(BOB, "slowness", 0, 120, Optional.of(ALICE)));
    }

    @Test
    void aVampireKillSaysHeartsInTheOriginalsColours() {
      var bout =
          new Bout().with(ALICE, TeamColor.RED, "vampire").with(BOB, TeamColor.BLUE, "trooper");
      bout.start();

      assertThat(bout.kill(BOB, ALICE))
          .contains(
              new AbilityEffect.Say(
                  List.of(ALICE),
                  "§7You gained §a1 Hearts§7 for killing §e" + bout.name(BOB),
                  AbilityEffect.Tone.LEGACY));
    }

    @Test
    void warpedVictimsFaceTheWayTheWarperFaced() {
      var bout =
          new Bout().with(ALICE, TeamColor.RED, "warper").with(BOB, TeamColor.BLUE, "trooper");
      bout.start();
      var facing =
          new Motion(
              new Vec3(5, 64, 5),
              Vec3.ZERO,
              90,
              -30,
              false,
              false,
              true,
              20,
              20,
              false,
              false,
              true);
      bout.tick(Map.of(ALICE, facing));
      bout.advance(Warper.FIRST_RECHARGE);

      assertThat(bout.act(ALICE, new AbilityInput.Warp(List.of(BOB))))
          .contains(new AbilityEffect.Send(BOB, new Vec3(5, 64, 5), 90, -30, Optional.of(ALICE)));
    }
  }
}
