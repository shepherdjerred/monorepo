package sjer.red.openai.socialnetwork;

import java.util.List;

/**
 * PROBLEM: Social Network (Follow System with Snapshot)
 * <p>
 * PART 2: Top-K Recommendation (cumulative ~30-40 minutes)
 * - All Part 1 functionality, plus:
 * - List&lt;Integer&gt; recommend(int userId, int k) — return top K users by follower count
 *   among "friends of friends" (users followed by userId's followees, excluding userId
 *   and users userId already follows). Ties broken by user ID ascending.
 * <p>
 * Examples:
 * follow(1, 2); follow(1, 3);
 * follow(2, 4); follow(2, 5);
 * follow(3, 4); follow(3, 6);
 * recommend(1, 2) → [4, 5] (4 has 2 followers among 1's followees, 5 and 6 have 1 each, tie broken by ID)
 * <p>
 * TIME TARGET: ~15-20 minutes (cumulative ~30-40)
 */
public class SocialNetworkP2 {

    public SocialNetworkP2() {
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

    /**
     * Return top K recommended users for userId.
     * Candidates are "friends of friends": users followed by userId's followees,
     * excluding userId themselves and users userId already follows.
     * Ranked by follower count (among userId's followees) descending,
     * ties broken by user ID ascending.
     *
     * @return list of up to k recommended user IDs
     */
    public List<Integer> recommend(int userId, int k) {
        // TODO: implement
        throw new UnsupportedOperationException("Not yet implemented");
    }
}
