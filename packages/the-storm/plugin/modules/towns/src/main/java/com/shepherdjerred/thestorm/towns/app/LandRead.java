package com.shepherdjerred.thestorm.towns.app;

/** Main-thread ownership checks for bounded, repo-authored world provisioning. */
public interface LandRead {
  boolean wilderness(String world, int x, int y, int z);
}
