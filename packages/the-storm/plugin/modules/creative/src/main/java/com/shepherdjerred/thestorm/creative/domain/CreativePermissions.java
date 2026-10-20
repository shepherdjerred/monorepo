package com.shepherdjerred.thestorm.creative.domain;

/** Permissions documented for creative staff. They are not a LuckPerms export. */
public final class CreativePermissions {

  /** Build on a closed plot, and skip the claim cap. Roads and other people's plots stay closed. */
  public static final String BYPASS = "thestorm.creative.bypass";

  /** Assign, unclaim, and scan. Does not write the historical catalog. */
  public static final String ADMIN = "thestorm.creative.admin";

  private CreativePermissions() {}
}
