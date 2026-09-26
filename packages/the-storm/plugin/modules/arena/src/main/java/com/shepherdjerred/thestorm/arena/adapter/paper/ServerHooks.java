package com.shepherdjerred.thestorm.arena.adapter.paper;

/**
 * The server operations tests replace, because MockBukkit does not implement them.
 *
 * @param chunks keeps arena chunks loaded while a game runs
 */
public record ServerHooks(ChunkKeeper chunks) {}
