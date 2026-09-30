package com.shepherdjerred.thestorm.qol.adapter.paper;

import io.papermc.paper.datacomponent.item.ResolvableProfile;
import java.util.UUID;
import org.bukkit.block.Skull;

/** The face a grave head wears. */
@FunctionalInterface
interface GraveFace {

  /** Puts a face on {@code skull} for the grave of {@code owner}. */
  void apply(Skull skull, UUID owner);

  /** The owner's own face; the server resolves their skin. */
  GraveFace OWNER =
      (skull, owner) -> skull.setProfile(ResolvableProfile.resolvableProfile().uuid(owner).build());

  /** The default head, for test servers that cannot resolve profiles. */
  GraveFace PLAIN = (skull, owner) -> {};
}
