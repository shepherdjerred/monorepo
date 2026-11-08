package com.shepherdjerred.thestorm.mechanics.e2e;

import java.util.Objects;
import net.kyori.adventure.text.Component;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.block.Container;
import org.bukkit.block.Sign;
import org.bukkit.block.sign.Side;
import org.bukkit.entity.Cow;
import org.bukkit.entity.Sheep;
import org.bukkit.inventory.ItemStack;

/** Unsigned, uncatalogued signs placed before module startup exercise real chunk discovery. */
final class CircuitFixtures {
  private static final int Y = -40;

  private final World world;

  private CircuitFixtures(World world) {
    this.world = world;
  }

  static void prepare(World world) {
    new CircuitFixtures(world).prepare();
  }

  private void prepare() {
    for (var x = 510; x <= 611; x++) for (var z = -4; z <= 4; z++) set(x, Y - 1, z, "sea_lantern");
    circuit(512, "[MC1001]", "", "");
    circuit(516, "[MC1421]", "5", "");
    circuit(520, "[MC1110]", "restoration", "");
    input(520);
    circuit(524, "[MC1111]s", "restoration", "");
    circuit(528, "[MC1421]", "5", "");
    set(528, Y, 2, "air");
    circuit(532, "[MC1111]s", "protected-wireless", "");
    circuit(536, "[MC1110]", "protected-wireless", "");
    input(536);

    circuit(544, "[MC1234]S", "295", "0=0:1:2");
    chest(544, ItemStack.of(Material.WHEAT_SEEDS, 8));
    set(544, Y, -1, "farmland[moisture=7]");
    set(545, Y, -1, "water");
    circuit(548, "[MC1223]S", "0=0:1:2", "");
    chest(548, ItemStack.of(Material.BONE_MEAL, 16));
    wheat(548, 0);
    circuit(552, "[MC1239]S", "0=0:1:2", "");
    chest(552);
    wheat(552, 7);
    circuit(556, "[MC1235]S", "0=0:0:2", "");
    chest(556, ItemStack.of(Material.IRON_HOE));
    set(556, Y, -1, "dirt");
    circuit(560, "[MC1220]S", "4", "");
    set(560, Y + 1, 1, "cobblestone");
    circuit(564, "[MC1220]S", "54", "");
    chest(564, ItemStack.of(Material.GOLD_INGOT, 3));

    circuit(568, "[MC1219]S", "", "");
    set(568, Y + 1, 1, "dispenser[facing=east]");
    inventory(568, Y + 1, 1).addItem(ItemStack.of(Material.OAK_PLANKS, 2));
    set(569, Y + 1, 1, "chest");
    circuit(572, "[MC1229]S", "", "");
    chest(572, ItemStack.of(Material.DIAMOND));
    set(571, Y, 1, "chest");
    set(573, Y, 1, "chest");
    world.dropItem(new Location(world, 572.5, Y + 0.5, 0.5), ItemStack.of(Material.DIAMOND, 3));
    world.dropItem(new Location(world, 572.5, Y + 0.5, 0.5), ItemStack.of(Material.OAK_PLANKS, 4));

    circuit(580, "[MC1244]S", "2=0:0:2", "");
    chest(580, ItemStack.of(Material.BUCKET), ItemStack.of(Material.SHEARS));
    input(580);
    world.spawn(
        new Location(world, 580.5, Y, -2.5),
        Cow.class,
        cow -> {
          cow.setAdult();
          cow.setAI(false);
        });
    world.spawn(
        new Location(world, 580.5, Y, -2.5),
        Sheep.class,
        sheep -> {
          sheep.setAdult();
          sheep.setAI(false);
          sheep.setColor(org.bukkit.DyeColor.BLUE);
        });
    circuit(586, "[MC1280]S", "2=0:0:2", "");
    chest(586, ItemStack.of(Material.WHEAT, 2));
    input(586);
    world.spawn(
        new Location(world, 586.5, Y, -2.5),
        Cow.class,
        cow -> {
          cow.setAdult();
          cow.setAI(false);
        });
    world.spawn(
        new Location(world, 586.5, Y, -2.5),
        Cow.class,
        cow -> {
          cow.setAdult();
          cow.setAI(false);
        });

    circuit(592, "[MC1223]S", "0=0:1:2", "");
    chest(592, ItemStack.of(Material.BONE_MEAL, 16));
    wheat(592, 0);
    circuit(600, "[MC1223]S", "0=0:1:2", "");
    chest(600, ItemStack.of(Material.BONE_MEAL));
    set(600, Y, -1, "dirt");
    set(600, Y + 1, -1, "oak_sapling");
    circuit(608, "[MC1223]S", "0=0:1:2", "");
    chest(608, ItemStack.of(Material.BONE_MEAL));
    set(608, Y, -1, "dirt");
    set(608, Y + 1, -1, "oak_sapling");
    for (var dx = -1; dx <= 1; dx++)
      for (var dz = -1; dz <= 1; dz++) world.getChunkAt((600 >> 4) + dx, (-1 >> 4) + dz);
  }

  private void circuit(int x, String tag, String third, String fourth) {
    set(x, Y, 1, "stone");
    set(x, Y, 2, "lever[face=wall,facing=south,powered=false]");
    set(x, Y, 0, "oak_wall_sign[facing=north]");
    var sign = (Sign) world.getBlockAt(x, Y, 0).getState();
    var side = sign.getSide(Side.FRONT);
    side.line(0, Component.empty());
    side.line(1, Component.text(tag));
    side.line(2, Component.text(third));
    side.line(3, Component.text(fourth));
    if (!sign.update(false, false))
      throw new IllegalStateException("could not prepare unsigned IC");
  }

  private void input(int x) {
    set(x, Y, -1, "lever[face=floor,facing=north,powered=true]");
  }

  private void wheat(int x, int age) {
    set(x + 1, Y, -1, "water");
    set(x, Y, -1, "farmland[moisture=7]");
    set(x, Y + 1, -1, "wheat[age=" + age + "]");
  }

  private void chest(int x, ItemStack... contents) {
    set(x, Y + 1, 1, "chest");
    inventory(x, Y + 1, 1).addItem(contents);
  }

  private org.bukkit.inventory.Inventory inventory(int x, int y, int z) {
    return ((Container) world.getBlockAt(x, y, z).getState()).getInventory();
  }

  private void set(int x, int y, int z, String state) {
    Objects.requireNonNull(world)
        .getBlockAt(x, y, z)
        .setBlockData(Bukkit.createBlockData("minecraft:" + state), false);
  }
}
