package sjer.red.openai.socialnetwork;

/**
 * PROBLEM: Social Network (Follow System with Snapshot)
 * SOURCE: From Shuxin
 * <p>
 * PART 1: Follow/Unfollow with Snapshots
 * - follow(int a, int b) — user a follows user b
 * - unfollow(int a, int b) — user a unfollows user b
 * - int snap() — take snapshot, return snapId (0-indexed, incrementing)
 * - boolean isFollowing(int a, int b, int snapId) — was a following b at that snapshot?
 * <p>
 * Examples:
 * follow(1, 2)
 * snap() → 0
 * isFollowing(1, 2, 0) → true
 * unfollow(1, 2)
 * snap() → 1
 * isFollowing(1, 2, 1) → false
 * isFollowing(1, 2, 0) → true
 * <p>
 * KEY INSIGHT: Snapshot versioning via TreeMap per (a,b) pair. Similar to LeetCode 1146 Snapshot Array.
 * TIME TARGET: ~15-20 minutes
 */
public class SocialNetworkP1 {

    public SocialNetworkP1() {
        // TODO: initialize data structures
    }

    /**
     * User a follows user b.
     */
    public void follow(int a, int b) {
        // TODO: implement
        throw new UnsupportedOperationException("Not yet implemented");
    }

    /**
     * User a unfollows user b.
     */
    public void unfollow(int a, int b) {
        // TODO: implement
        throw new UnsupportedOperationException("Not yet implemented");
    }

    /**
     * Take a snapshot of the current state.
     *
     * @return the snapshot ID (0-indexed, incrementing)
     */
    public int snap() {
        // TODO: implement
        throw new UnsupportedOperationException("Not yet implemented");
    }

    /**
     * Check whether user a was following user b at the given snapshot.
     *
     * @return true if a was following b at snapId
     */
    public boolean isFollowing(int a, int b, int snapId) {
        // TODO: implement
        throw new UnsupportedOperationException("Not yet implemented");
    }
}
