package com.shepherdjerred.thestorm.e2e;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.towns.adapter.db.JooqLocksStore;
import com.shepherdjerred.thestorm.towns.domain.land.BlockPos;
import com.shepherdjerred.thestorm.towns.domain.lock.Lock;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.inventory.ItemStack;

/** Test-only pre-enable database fixture: prove the same imported records load on real Paper. */
final class HistoricalLockFixtures {
  private HistoricalLockFixtures() {}

  static void seed(World world, java.nio.file.Path content) {
    var alpha = offline("historyalpha");
    var beta = offline("historybeta");
    var request =
        UUID.nameUUIDFromBytes("historical-lock-fixture".getBytes(StandardCharsets.UTF_8));
    var joint =
        new Lock.Restoration(
            request, "parcel:fixture-joint", Map.of(alpha, "historyalpha", beta, "historybeta"));
    var single =
        new Lock.Restoration(request, "heritage:fixture-town", Map.of(alpha, "historyalpha"));
    for (var x = 337; x <= 367; x++) {
      for (var z = 31; z <= 45; z++) {
        world.getBlockAt(x, 200, z).setType(Material.STONE, false);
      }
    }
    world
        .getBlockAt(340, 201, 35)
        .setBlockData(Bukkit.createBlockData("minecraft:chest[facing=north,type=left]"), false);
    world
        .getBlockAt(341, 201, 35)
        .setBlockData(Bukkit.createBlockData("minecraft:chest[facing=north,type=right]"), false);
    var chest = (org.bukkit.block.Chest) world.getBlockAt(340, 201, 35).getState();
    chest.getBlockInventory().addItem(new ItemStack(Material.DIAMOND, 7));
    world
        .getBlockAt(340, 200, 35)
        .setBlockData(Bukkit.createBlockData("minecraft:hopper[enabled=false]"), false);
    world.getBlockAt(340, 199, 35).setType(Material.HOPPER, false);
    world.getBlockAt(344, 201, 35).setType(Material.CHEST, false);
    // Fixture enable precedes TheStorm enable. Only this disposable startup synchronously
    // seeds the database; all player-triggered persistence still uses the production async path.
    try (var database = StormDatabase.open(content.resolve("the-storm.db"))) {
      database.migrate("towns", Lock.class.getClassLoader());
      var store = new JooqLocksStore(database);
      store
          .save(lock(alpha, Set.of(pos(340, 201, 35), pos(341, 201, 35)), joint))
          .get(30, TimeUnit.SECONDS);
      store.save(lock(alpha, Set.of(pos(340, 200, 35)), joint)).get(30, TimeUnit.SECONDS);
      for (var index = 0; index < 70; index++) {
        var position = pos(350 + index % 10, 201, 36 + index / 10);
        world.getBlockAt(position.x(), position.y(), position.z()).setType(Material.BARREL, false);
        store.save(lock(alpha, Set.of(position), single)).get(30, TimeUnit.SECONDS);
      }
    } catch (Exception failure) {
      throw new IllegalStateException("Historical lock startup fixture failed", failure);
    }
  }

  private static Lock lock(UUID owner, Set<BlockPos> blocks, Lock.Restoration restoration) {
    return new Lock(UUID.randomUUID(), owner, blocks, Map.of(), Lock.Options.NONE, restoration);
  }

  private static BlockPos pos(int x, int y, int z) {
    return new BlockPos("world", x, y, z);
  }

  private static UUID offline(String name) {
    return UUID.nameUUIDFromBytes(("OfflinePlayer:" + name).getBytes(StandardCharsets.UTF_8));
  }
}
