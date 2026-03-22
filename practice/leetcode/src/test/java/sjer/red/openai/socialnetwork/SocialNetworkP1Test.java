package sjer.red.openai.socialnetwork;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;

import static org.junit.jupiter.api.Assertions.*;

class SocialNetworkP1Test {
    private SocialNetworkP1 sn;

    private static boolean v(boolean val, String prefix) {
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
        sn = new SocialNetworkP1();
    }

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
    void scenario_A3_follow_then_unfollow_then_snap_returns_false() {
        sn.follow(1, 2);
        sn.unfollow(1, 2);
        int snapId = sn.snap();
        assertFalse(sn.isFollowing(1, 2, snapId));
    }

    @Test
    void scenario_A4_multiple_snaps_check_historical_state() {
        sn.follow(1, 2);
        int snap0 = sn.snap();
        sn.follow(1, 3);
        int snap1 = sn.snap();
        assertTrue(sn.isFollowing(1, 2, snap0));
        assertTrue(sn.isFollowing(1, 2, snap1));
        assertFalse(sn.isFollowing(1, 3, snap0));
        assertTrue(sn.isFollowing(1, 3, snap1));
    }

    @Test
    void scenario_A5_snap_before_any_follows() {
        int snapId = sn.snap();
        assertEquals(0, snapId);
        assertFalse(sn.isFollowing(1, 2, snapId));
    }

    @Test
    void scenario_A6_follow_snap_unfollow_snap_check_both() {
        sn.follow(1, 2);
        int snap0 = sn.snap();
        sn.unfollow(1, 2);
        int snap1 = sn.snap();
        // sha256("true") starts with "b5bea41"
        assertTrue(v(sn.isFollowing(1, 2, snap0), "b5bea41"));
        assertFalse(sn.isFollowing(1, 2, snap1));
    }

    @Test
    void scenario_A7_repeated_follow_is_idempotent() {
        sn.follow(1, 2);
        sn.follow(1, 2);
        sn.follow(1, 2);
        int snapId = sn.snap();
        assertTrue(sn.isFollowing(1, 2, snapId));
        sn.unfollow(1, 2);
        int snap1 = sn.snap();
        assertFalse(sn.isFollowing(1, 2, snap1));
    }

    @Test
    void scenario_A8_unfollow_without_prior_follow_is_noop() {
        sn.unfollow(1, 2);
        int snapId = sn.snap();
        assertFalse(sn.isFollowing(1, 2, snapId));
    }

    @Test
    void scenario_A9_multiple_users_following_same_target() {
        sn.follow(1, 10);
        sn.follow(2, 10);
        sn.follow(3, 10);
        int snapId = sn.snap();
        assertTrue(sn.isFollowing(1, 10, snapId));
        assertTrue(sn.isFollowing(2, 10, snapId));
        assertTrue(sn.isFollowing(3, 10, snapId));
        assertFalse(sn.isFollowing(4, 10, snapId));
    }

    @Test
    void scenario_A10_isFollowing_with_snap0_before_any_operations() {
        int snap0 = sn.snap();
        sn.follow(1, 2);
        int snap1 = sn.snap();
        assertFalse(sn.isFollowing(1, 2, snap0));
        assertTrue(sn.isFollowing(1, 2, snap1));
    }
}
