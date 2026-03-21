package sjer.red.openai.cddirectory;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.Base64;

import static org.junit.jupiter.api.Assertions.assertTrue;

class CdDirectoryP2Test {
    private CdDirectoryP2 solver;

    private static String d(String b64) {
        return new String(Base64.getDecoder().decode(b64), StandardCharsets.UTF_8);
    }

    @BeforeEach
    void setUp() {
        solver = new CdDirectoryP2();
    }

    // Regression from Part 1
    @Test
    void scenario_A1() {
        assertTrue(d("L2hvbWUvdXNlci9kb2Nz").equals(solver.cd("/home/user", "docs", "/home/default")));
    }

    @Test
    void scenario_A2() {
        assertTrue(d("L2hvbWU=").equals(solver.cd("/home/user", "..", "/home/default")));
    }

    @Test
    void scenario_A3() {
        assertTrue(d("Lw==").equals(solver.cd("/", "..", "/home/default")));
    }

    @Test
    void scenario_A4() {
        assertTrue(d("L2V0Yw==").equals(solver.cd("/home/user", "/etc", "/home/default")));
    }

    @Test
    void scenario_A5() {
        assertTrue(d("L2hvbWUvdXNlci9waWNz").equals(solver.cd("/home/user", "./docs/../pics", "/home/default")));
    }

    @Test
    void scenario_A6() {
        assertTrue(d("Lw==").equals(solver.cd("/a/b/c", "../../..", "/home/default")));
    }

    @Test
    void scenario_A7() {
        assertTrue(d("L2EvYi9j").equals(solver.cd("/a/b/c", ".", "/home/default")));
    }

    @Test
    void scenario_A8() {
        assertTrue(d("L3gveQ==").equals(solver.cd("/a", "/x/y/z/..", "/home/default")));
    }

    @Test
    void scenario_A9() {
        assertTrue(d("L2E=").equals(solver.cd("/a/b/c/d/e", "../../../..", "/home/default")));
    }

    @Test
    void scenario_A10() {
        assertTrue(d("L2EvYg==").equals(solver.cd("/a", "b", "/home/default")));
    }

    // New: home directory support
    @Test
    void scenario_B1() {
        assertTrue(d("L2hvbWUvamVycmVk").equals(solver.cd("/tmp", "~", "/home/jerred")));
    }

    @Test
    void scenario_B2() {
        assertTrue(d("L2hvbWUvamVycmVkL2RvY3M=").equals(solver.cd("/tmp", "~/docs", "/home/jerred")));
    }

    @Test
    void scenario_B3() {
        assertTrue(d("L2hvbWUvamVycmVk").equals(solver.cd("/anywhere", "~/docs/..", "/home/jerred")));
    }

    @Test
    void scenario_B4() {
        assertTrue(d("L3RtcC9hL34=").equals(solver.cd("/tmp", "a/~", "/home/jerred")));
    }

    @Test
    void scenario_B5() {
        assertTrue(d("Lw==").equals(solver.cd("/tmp", "~/../../..", "/home/jerred")));
    }

    @Test
    void scenario_B6() {
        assertTrue(d("Lw==").equals(solver.cd("/tmp", "~", "/")));
    }

    @Test
    void scenario_B7() {
        assertTrue(d("L2hvbWUvdXNlcg==").equals(solver.cd("/anywhere", "~", "/home/user")));
    }
}
