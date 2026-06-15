package sjer.red.openai.shardrebalancing;

import org.junit.jupiter.api.Test;

import java.util.Comparator;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class ShardRebalancingP2Test {

    // Regression (A1-A3)

    @Test
    void scenario_A1_single_shard_maxOverlap_is_1() {
        var sr = new ShardRebalancingP2(2);
        sr.addShard(new ShardRebalancingP2.Shard("A", 0, 100));
        assertEquals(1, sr.maxOverlap());
    }

    @Test
    void scenario_A2_two_overlapping_shards() {
        var sr = new ShardRebalancingP2(2);
        sr.addShard(new ShardRebalancingP2.Shard("A", 0, 100));
        sr.addShard(new ShardRebalancingP2.Shard("B", 80, 180));
        assertEquals(2, sr.maxOverlap());
    }

    @Test
    void scenario_A3_remove_shard_reduces_overlap() {
        var sr = new ShardRebalancingP2(2);
        sr.addShard(new ShardRebalancingP2.Shard("A", 0, 100));
        sr.addShard(new ShardRebalancingP2.Shard("B", 80, 180));
        assertTrue(sr.removeShard("B"));
        assertEquals(1, sr.maxOverlap());
    }

    // New (B1-B7)

    @Test
    void scenario_B1_rebalance_trims_later_shard() {
        var sr = new ShardRebalancingP2(1);
        sr.addShard(new ShardRebalancingP2.Shard("A", 0, 100));
        sr.addShard(new ShardRebalancingP2.Shard("B", 80, 180));
        var result = sr.rebalance();
        assertEquals(2, result.size());
        var sorted = result.stream().sorted(Comparator.comparingInt(ShardRebalancingP2.Shard::start)).toList();
        assertEquals(0, sorted.get(0).start());
        assertEquals(100, sorted.get(0).end());
        assertEquals(101, sorted.get(1).start());
        assertEquals(180, sorted.get(1).end());
        assertTrue(sr.isValid());
    }

    @Test
    void scenario_B2_three_overlapping_shards_limit_1() {
        var sr = new ShardRebalancingP2(1);
        sr.addShard(new ShardRebalancingP2.Shard("A", 0, 100));
        sr.addShard(new ShardRebalancingP2.Shard("B", 50, 150));
        sr.addShard(new ShardRebalancingP2.Shard("C", 80, 200));
        var result = sr.rebalance();
        assertEquals(3, result.size());
        assertTrue(sr.isValid());
    }

    @Test
    void scenario_B3_already_valid_no_change() {
        var sr = new ShardRebalancingP2(1);
        sr.addShard(new ShardRebalancingP2.Shard("A", 0, 50));
        sr.addShard(new ShardRebalancingP2.Shard("B", 60, 100));
        var result = sr.rebalance();
        assertEquals(2, result.size());
        var sorted = result.stream().sorted(Comparator.comparingInt(ShardRebalancingP2.Shard::start)).toList();
        assertEquals(0, sorted.get(0).start());
        assertEquals(50, sorted.get(0).end());
        assertEquals(60, sorted.get(1).start());
        assertEquals(100, sorted.get(1).end());
    }

    @Test
    void scenario_B4_complete_containment() {
        var sr = new ShardRebalancingP2(1);
        sr.addShard(new ShardRebalancingP2.Shard("A", 0, 200));
        sr.addShard(new ShardRebalancingP2.Shard("B", 50, 100));
        var result = sr.rebalance();
        assertTrue(sr.isValid());
        // B is fully contained in A; after rebalance, B must be trimmed past A's end
        var sorted = result.stream().sorted(Comparator.comparingInt(ShardRebalancingP2.Shard::start)).toList();
        assertEquals(0, sorted.get(0).start());
        assertEquals(200, sorted.get(0).end());
    }

    @Test
    void scenario_B5_rebalance_with_limit_2_allows_some_overlap() {
        var sr = new ShardRebalancingP2(2);
        sr.addShard(new ShardRebalancingP2.Shard("A", 0, 100));
        sr.addShard(new ShardRebalancingP2.Shard("B", 50, 150));
        sr.addShard(new ShardRebalancingP2.Shard("C", 80, 200));
        var result = sr.rebalance();
        assertTrue(sr.isValid());
        assertTrue(result.size() >= 2);
    }

    @Test
    void scenario_B6_chain_of_overlapping_shards() {
        var sr = new ShardRebalancingP2(1);
        sr.addShard(new ShardRebalancingP2.Shard("A", 0, 50));
        sr.addShard(new ShardRebalancingP2.Shard("B", 30, 80));
        sr.addShard(new ShardRebalancingP2.Shard("C", 60, 120));
        sr.addShard(new ShardRebalancingP2.Shard("D", 100, 160));
        var result = sr.rebalance();
        assertEquals(4, result.size());
        assertTrue(sr.isValid());
    }

    @Test
    void scenario_B7_shards_sorted_by_start_after_rebalance() {
        var sr = new ShardRebalancingP2(1);
        sr.addShard(new ShardRebalancingP2.Shard("C", 80, 200));
        sr.addShard(new ShardRebalancingP2.Shard("A", 0, 100));
        sr.addShard(new ShardRebalancingP2.Shard("B", 50, 150));
        var result = sr.rebalance();
        for (int i = 1; i < result.size(); i++) {
            assertTrue(result.get(i).start() >= result.get(i - 1).start(),
                    "Shards should be sorted by start after rebalance");
        }
        assertTrue(sr.isValid());
    }
}
