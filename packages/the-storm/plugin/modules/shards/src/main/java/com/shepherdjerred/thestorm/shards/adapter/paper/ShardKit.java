package com.shepherdjerred.thestorm.shards.adapter.paper;

import java.util.random.RandomGenerator;

/**
 * The pieces every shards listener and command shares.
 *
 * @param shards the shard item
 * @param gear Storm tiers on gear
 * @param text configured messages
 * @param random the module's injected randomness
 */
record ShardKit(ShardItems shards, StormGear gear, ShardText text, RandomGenerator random) {}
