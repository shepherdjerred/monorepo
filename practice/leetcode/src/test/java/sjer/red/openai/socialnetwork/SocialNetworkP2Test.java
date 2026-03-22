package sjer.red.openai.socialnetwork;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class SocialNetworkP2Test {
    private SocialNetworkP2 sn;

    private static boolean v(int val, String prefix) {
        try {
            var md = MessageDigest.getInstance("SHA-256");
            byte[] hash = md.digest(String.valueOf(val).getBytes(StandardCharsets.UTF_8));
            String hex = HexFormat.of().formatHex(hash);
            return hex.startsWith(prefix);
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    @BeforeEach
    void setUp() {
        sn = new SocialNetworkP2();
    }

    // Regression (A1-A3)

    @Test
    void scenario_A1_follow_then_snap_returns_true() {
        sn.follow(1, 2);
        int snapId = sn.snap();
        assertTrue(sn.isFollowing(1, 2, snapId));
    }

    @Test
    void scenario_A2_not_following_returns_false() {
        sn.snap();
        assertFalse(sn.isFollowing(1, 2, 0));
    }

    @Test
    void scenario_A3_follow_unfollow_snap_returns_false() {
        sn.follow(1, 2);
        sn.unfollow(1, 2);
        int snapId = sn.snap();
        assertFalse(sn.isFollowing(1, 2, snapId));
    }

    // New (B1-B8)

    @Test
    void scenario_B1_simple_recommend() {
        sn.follow(1, 2);
        sn.follow(1, 3);
        sn.follow(2, 4);
        sn.follow(2, 5);
        sn.follow(3, 4);
        sn.follow(3, 6);
        // 4 is followed by both 2 and 3 (count=2), 5 by 2 (count=1), 6 by 3 (count=1)
        List<Integer> result = sn.recommend(1, 2);
        assertEquals(List.of(4, 5), result);
    }

    @Test
    void scenario_B2_recommend_excludes_already_followed() {
        sn.follow(1, 2);
        sn.follow(1, 3);
        sn.follow(2, 3);
        sn.follow(2, 4);
        // 3 is followed by 2 but 1 already follows 3 — exclude it
        // 4 is followed by 2 — recommend it
        List<Integer> result = sn.recommend(1, 5);
        assertEquals(List.of(4), result);
    }

    @Test
    void scenario_B3_recommend_excludes_self() {
        sn.follow(1, 2);
        sn.follow(2, 1);
        sn.follow(2, 3);
        // 1 follows 2; 2 follows 1 and 3
        // candidates from 2's followees: 1 (self, exclude) and 3
        List<Integer> result = sn.recommend(1, 5);
        assertEquals(List.of(3), result);
    }

    @Test
    void scenario_B4_k_larger_than_candidates() {
        sn.follow(1, 2);
        sn.follow(2, 3);
        List<Integer> result = sn.recommend(1, 10);
        assertEquals(List.of(3), result);
    }

    @Test
    void scenario_B5_k_zero_returns_empty() {
        sn.follow(1, 2);
        sn.follow(2, 3);
        List<Integer> result = sn.recommend(1, 0);
        assertEquals(List.of(), result);
    }

    @Test
    void scenario_B6_no_follows_returns_empty() {
        List<Integer> result = sn.recommend(1, 5);
        assertEquals(List.of(), result);
    }

    @Test
    void scenario_B7_tiebreaking_by_user_id() {
        sn.follow(1, 2);
        sn.follow(2, 10);
        sn.follow(2, 5);
        sn.follow(2, 8);
        // All candidates have count=1, tie-break by user ID ascending
        // sha256("3") starts with "4e074085"
        assertTrue(v(sn.recommend(1, 3).size(), "4e074085"));
        assertEquals(List.of(5, 8, 10), sn.recommend(1, 3));
    }

    @Test
    void scenario_B8_recommend_after_unfollow() {
        sn.follow(1, 2);
        sn.follow(1, 3);
        sn.follow(2, 4);
        sn.follow(3, 4);
        assertEquals(List.of(4), sn.recommend(1, 5));
        // After unfollowing 2, only 3's followees are candidates
        sn.unfollow(1, 2);
        List<Integer> result = sn.recommend(1, 5);
        // 4 still recommended via 3, but now count=1 instead of 2
        assertEquals(List.of(4), result);
        // Also 2 is no longer followed, so 2 could appear if 3 follows 2
        sn.follow(3, 2);
        assertEquals(List.of(2, 4), sn.recommend(1, 5));
    }
}
