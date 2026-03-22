package sjer.red.openai.cddirectory;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.Base64;

import static org.junit.jupiter.api.Assertions.assertEquals;

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
        assertEquals(d("L2hvbWUvdXNlci9kb2Nz"), solver.cd("/home/user", "docs", "/home/default"));
    }

    @Test
    void scenario_A2() {
        assertEquals(d("L2hvbWU="), solver.cd("/home/user", "..", "/home/default"));
    }

    @Test
    void scenario_A3() {
        assertEquals(d("Lw=="), solver.cd("/", "..", "/home/default"));
    }

    @Test
    void scenario_A4() {
        assertEquals(d("L2V0Yw=="), solver.cd("/home/user", "/etc", "/home/default"));
    }

    @Test
    void scenario_A5() {
        assertEquals(d("L2hvbWUvdXNlci9waWNz"), solver.cd("/home/user", "./docs/../pics", "/home/default"));
    }

    @Test
    void scenario_A6() {
        assertEquals(d("Lw=="), solver.cd("/a/b/c", "../../..", "/home/default"));
    }

    @Test
    void scenario_A7() {
        assertEquals(d("L2EvYi9j"), solver.cd("/a/b/c", ".", "/home/default"));
    }

    @Test
    void scenario_A8() {
        assertEquals(d("L3gveQ=="), solver.cd("/a", "/x/y/z/..", "/home/default"));
    }

    @Test
    void scenario_A9() {
        assertEquals(d("L2E="), solver.cd("/a/b/c/d/e", "../../../..", "/home/default"));
    }

    @Test
    void scenario_A10() {
        assertEquals(d("L2EvYg=="), solver.cd("/a", "b", "/home/default"));
    }

    // New: home directory support
    @Test
    void scenario_B1() {
        assertEquals(d("L2hvbWUvamVycmVk"), solver.cd("/tmp", "~", "/home/jerred"));
    }

    @Test
    void scenario_B2() {
        assertEquals(d("L2hvbWUvamVycmVkL2RvY3M="), solver.cd("/tmp", "~/docs", "/home/jerred"));
    }

    @Test
    void scenario_B3() {
        assertEquals(d("L2hvbWUvamVycmVk"), solver.cd("/anywhere", "~/docs/..", "/home/jerred"));
    }

    @Test
    void scenario_B4() {
        assertEquals(d("L3RtcC9hL34="), solver.cd("/tmp", "a/~", "/home/jerred"));
    }

    @Test
    void scenario_B5() {
        assertEquals(d("Lw=="), solver.cd("/tmp", "~/../../..", "/home/jerred"));
    }

    @Test
    void scenario_B6() {
        assertEquals(d("Lw=="), solver.cd("/tmp", "~", "/"));
    }

    @Test
    void scenario_B7() {
        assertEquals(d("L2hvbWUvdXNlcg=="), solver.cd("/anywhere", "~", "/home/user"));
    }
}
