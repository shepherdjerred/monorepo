package sjer.red.openai.shardrebalancing;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class ShardRebalancingP1Test {

    @Test
    void scenario_A1_single_shard_maxOverlap_is_1() {
        var sr = new ShardRebalancingP1(2);
        sr.addShard(new ShardRebalancingP1.Shard("A", 0, 100));
        assertEquals(1, sr.maxOverlap());
    }

    @Test
    void scenario_A2_two_non_overlapping_shards() {
        var sr = new ShardRebalancingP1(2);
        sr.addShard(new ShardRebalancingP1.Shard("A", 0, 50));
        sr.addShard(new ShardRebalancingP1.Shard("B", 60, 100));
        assertEquals(1, sr.maxOverlap());
    }

    @Test
    void scenario_A3_two_overlapping_shards() {
        var sr = new ShardRebalancingP1(2);
        sr.addShard(new ShardRebalancingP1.Shard("A", 0, 100));
        sr.addShard(new ShardRebalancingP1.Shard("B", 80, 180));
        assertEquals(2, sr.maxOverlap());
    }

    @Test
    void scenario_A4_remove_shard_reduces_overlap() {
        var sr = new ShardRebalancingP1(2);
        sr.addShard(new ShardRebalancingP1.Shard("A", 0, 100));
        sr.addShard(new ShardRebalancingP1.Shard("B", 80, 180));
        assertEquals(2, sr.maxOverlap());
        assertTrue(sr.removeShard("B"));
        assertEquals(1, sr.maxOverlap());
    }

    @Test
    void scenario_A5_isValid_with_limit_2_two_overlapping() {
        var sr = new ShardRebalancingP1(2);
        sr.addShard(new ShardRebalancingP1.Shard("A", 0, 100));
        sr.addShard(new ShardRebalancingP1.Shard("B", 80, 180));
        assertTrue(sr.isValid());
    }

    @Test
    void scenario_A6_isValid_with_limit_1_two_overlapping() {
        var sr = new ShardRebalancingP1(1);
        sr.addShard(new ShardRebalancingP1.Shard("A", 0, 100));
        sr.addShard(new ShardRebalancingP1.Shard("B", 80, 180));
        assertFalse(sr.isValid());
    }

    @Test
    void scenario_A7_three_shards_all_overlapping() {
        var sr = new ShardRebalancingP1(3);
        sr.addShard(new ShardRebalancingP1.Shard("A", 0, 100));
        sr.addShard(new ShardRebalancingP1.Shard("B", 50, 150));
        sr.addShard(new ShardRebalancingP1.Shard("C", 80, 200));
        assertEquals(3, sr.maxOverlap());
    }

    @Test
    void scenario_A8_remove_nonexistent_shard() {
        var sr = new ShardRebalancingP1(2);
        sr.addShard(new ShardRebalancingP1.Shard("A", 0, 100));
        assertFalse(sr.removeShard("Z"));
    }

    @Test
    void scenario_B1_adjacent_shards_no_overlap() {
        var sr = new ShardRebalancingP1(1);
        sr.addShard(new ShardRebalancingP1.Shard("A", 0, 49));
        sr.addShard(new ShardRebalancingP1.Shard("B", 50, 99));
        sr.addShard(new ShardRebalancingP1.Shard("C", 100, 149));
        assertEquals(1, sr.maxOverlap());
        assertTrue(sr.isValid());
    }

    @Test
    void scenario_B2_complex_overlap_pattern() {
        var sr = new ShardRebalancingP1(3);
        sr.addShard(new ShardRebalancingP1.Shard("A", 0, 100));
        sr.addShard(new ShardRebalancingP1.Shard("B", 50, 150));
        sr.addShard(new ShardRebalancingP1.Shard("C", 120, 200));
        sr.addShard(new ShardRebalancingP1.Shard("D", 130, 180));
        // At point 130-150: B, C, D overlap → 3
        assertEquals(3, sr.maxOverlap());
        assertTrue(sr.isValid());
    }
}
