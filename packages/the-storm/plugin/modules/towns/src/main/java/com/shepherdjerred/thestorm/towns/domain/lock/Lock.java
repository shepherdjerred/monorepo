package com.shepherdjerred.thestorm.towns.domain.lock;

import com.shepherdjerred.thestorm.towns.domain.land.BlockPos;
import java.time.Instant;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * A locked container: one block, or both halves of a double chest.
 *
 * @param id stable id
 * @param owner who locked it
 * @param blocks where it is; one or two blocks
 * @param trusted players the owner lets in, and whether each may also break it
 * @param options what else the owner allows
 */
public record Lock(
    UUID id,
    UUID owner,
    Set<BlockPos> blocks,
    Map<UUID, LockGrant> trusted,
    Options options,
    Restoration restoration) {

  /** A double chest is the largest container a lock covers. */
  public static final int MAX_BLOCKS = 2;

  public Lock {
    blocks = Set.copyOf(blocks);
    trusted = Map.copyOf(trusted);
    if (blocks.isEmpty() || blocks.size() > MAX_BLOCKS) {
      throw new IllegalArgumentException("a lock covers one or two blocks, not " + blocks.size());
    }
    if (trusted.containsKey(owner)
        || restoration.owners().keySet().stream().anyMatch(trusted::containsKey)) {
      throw new IllegalArgumentException("a lock's owners are not in its trusted list");
    }
    if (restoration.imported() && !restoration.owners().containsKey(owner)) {
      throw new IllegalArgumentException("a restored lock must name its primary owner");
    }
  }

  /** Recorded historical identities also support joint shop management before anyone rejoins. */
  public record Restoration(UUID requestId, String holdingId, Map<UUID, String> owners) {
    private static final UUID NO_REQUEST = new UUID(0, 0);
    public static final UUID CUSTODIAN =
        UUID.nameUUIDFromBytes(
            "the-storm:historical-custody:v1".getBytes(java.nio.charset.StandardCharsets.UTF_8));
    public static final Restoration NONE = new Restoration(NO_REQUEST, "", Map.of());

    public Restoration {
      owners = Map.copyOf(owners);
      if (requestId.equals(NO_REQUEST)) {
        if (!holdingId.isEmpty() || !owners.isEmpty()) {
          throw new IllegalArgumentException("an ordinary lock has no restoration metadata");
        }
      } else if (!holdingId.matches("[a-z0-9_:-]{1,80}")
          || owners.isEmpty()
          || owners.values().stream().anyMatch(String::isBlank)) {
        throw new IllegalArgumentException("a restored lock needs a holding and named owners");
      }
    }

    public boolean imported() {
      return !requestId.equals(NO_REQUEST);
    }
  }

  public boolean ownedByPlayer(UUID player) {
    return owner.equals(player) || restoration.owners().containsKey(player);
  }

  public Set<UUID> owners() {
    var result = new HashSet<>(restoration.owners().keySet());
    result.add(owner);
    return Set.copyOf(result);
  }

  /** A new lock of {@code owner}'s on {@code blocks}, trusting nobody and allowing nothing else. */
  public static Lock of(UUID id, UUID owner, Set<BlockPos> blocks) {
    return new Lock(id, owner, blocks, Map.of(), Options.NONE, Lock.Restoration.NONE);
  }

  /**
   * What a lock's owner allows beyond the players they trust.
   *
   * @param sharedWithTown the owner's town mates may open it (never break it)
   * @param redstone redstone may make it dispense or craft, so anyone who can power it can make it
   *     give up its items
   * @param type how people who are not trusted may use it
   * @param password the word a password lock expects; empty for every other type
   * @param flags hopper, golem, magnet, autoclose, explosion, and expiry options
   * @param groups permission groups that may open it; each is {@code thestorm.towns.lock.group.}
   *     plus this name
   * @param towns towns, other than the owner's shared town, whose members may open it
   * @param lastUsed when it was last opened; {@link Instant#EPOCH} means never
   */
  public record Options(
      boolean sharedWithTown,
      boolean redstone,
      LockType type,
      String password,
      Flags flags,
      Set<String> groups,
      Set<UUID> towns,
      Instant lastUsed) {

    public static final Options NONE = new Options(false, false);

    /** A private lock with no extra flags. Existing callers keep this shape. */
    public Options(boolean sharedWithTown, boolean redstone) {
      this(
          sharedWithTown,
          redstone,
          LockType.PRIVATE,
          "",
          Flags.NONE,
          Set.of(),
          Set.of(),
          Instant.EPOCH);
    }

    public Options {
      groups = Set.copyOf(groups);
      towns = Set.copyOf(towns);
      if (type == LockType.PASSWORD) {
        if (password.isBlank()) {
          throw new IllegalArgumentException("a password lock needs a password");
        }
      } else if (!password.isEmpty()) {
        throw new IllegalArgumentException("only a password lock has a password");
      }
      if (groups.stream().anyMatch(name -> !name.matches("[a-z0-9._-]{1,32}"))) {
        throw new IllegalArgumentException("a lock group is 1..32 of a-z, 0-9, ., _ or -");
      }
    }

    public Options withShared(boolean shared) {
      return new Options(shared, redstone, type, password, flags, groups, towns, lastUsed);
    }

    public Options withRedstone(boolean allowed) {
      return new Options(sharedWithTown, allowed, type, password, flags, groups, towns, lastUsed);
    }

    public Options withType(LockType next, String word) {
      return new Options(
          sharedWithTown,
          redstone,
          next,
          next == LockType.PASSWORD ? word : "",
          flags,
          groups,
          towns,
          lastUsed);
    }

    public Options withFlags(Flags next) {
      return new Options(sharedWithTown, redstone, type, password, next, groups, towns, lastUsed);
    }

    public Options withGroups(Set<String> next) {
      return new Options(sharedWithTown, redstone, type, password, flags, next, towns, lastUsed);
    }

    public Options withTowns(Set<UUID> next) {
      return new Options(sharedWithTown, redstone, type, password, flags, groups, next, lastUsed);
    }

    /** The same allowances, marked opened at {@code when}. */
    public Options touched(Instant when) {
      return new Options(sharedWithTown, redstone, type, password, flags, groups, towns, when);
    }

    /** The same allowances on a new lock, which nobody has opened. */
    public Options unused() {
      return touched(Instant.EPOCH);
    }
  }

  /**
   * Extra allowances stored with the lock. Off means the historical restriction: hoppers follow the
   * same-owner rule, copper golems stay out, explosions cannot break it, and it can expire.
   */
  public record Flags(
      boolean hopper,
      boolean hopperIn,
      boolean hopperOut,
      boolean golem,
      boolean magnet,
      boolean autoclose,
      boolean explosions,
      boolean exempt) {

    public static final Flags NONE =
        new Flags(false, false, false, false, false, false, false, false);
  }

  /** A copy that also covers {@code block}, the other half of a double chest. */
  public Lock withBlock(BlockPos block) {
    var next = new HashSet<>(blocks);
    next.add(block);
    return new Lock(id, owner, next, trusted, options, restoration);
  }

  /** A copy without {@code block}; only for a lock that covers another block too. */
  public Lock withoutBlock(BlockPos block) {
    var next = new HashSet<>(blocks);
    next.remove(block);
    return new Lock(id, owner, next, trusted, options, restoration);
  }

  /** A copy that trusts {@code player} with {@code grant}. */
  public Lock withTrust(UUID player, LockGrant grant) {
    var next = new HashMap<>(trusted);
    next.put(player, grant);
    return new Lock(id, owner, blocks, next, options, restoration);
  }

  /** A copy that no longer trusts {@code player}. */
  public Lock withoutTrust(UUID player) {
    var next = new HashMap<>(trusted);
    next.remove(player);
    return new Lock(id, owner, blocks, next, options, restoration);
  }

  public Lock withOptions(Options next) {
    return new Lock(id, owner, blocks, trusted, next, restoration);
  }

  /** A copy whose type is {@code type}. {@code word} is kept only for a password lock. */
  public Lock withType(LockType type, String word) {
    return withOptions(options.withType(type, word));
  }

  /** A copy with {@code flag} set to {@code on}. */
  public Lock withFlag(LockFlag flag, boolean on) {
    return withOptions(options.withFlags(flag.apply(options.flags(), on)));
  }

  /** A copy marked opened at {@code when}. */
  public Lock touched(Instant when) {
    return withOptions(options.touched(when));
  }

  /**
   * This lock's blocks and owner, with {@code template}'s type, flags, list, groups and towns. The
   * new lock has not been opened.
   */
  public Lock styledLike(Lock template) {
    var next = new HashMap<>(template.trusted());
    owners().forEach(next::remove);
    return new Lock(id, owner, blocks, next, template.options().unused(), restoration);
  }

  /**
   * A copy owned by {@code newOwner}, who inherits it as it stands (for players leaving a town).
   */
  public Lock ownedBy(UUID newOwner) {
    if (restoration.imported()) {
      throw new IllegalStateException("restored ownership requires a named historical transfer");
    }
    var next = new HashMap<>(trusted);
    next.remove(newOwner);
    return new Lock(id, newOwner, blocks, next, options, restoration);
  }
}
