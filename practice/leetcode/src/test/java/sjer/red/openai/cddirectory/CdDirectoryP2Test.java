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
        assertEquals(d("L2hvbWUvdXNlci9kb2Nz"), solver.cd("/home/user", "docs"));
    }

    @Test
    void scenario_A2() {
        assertEquals(d("L2hvbWU="), solver.cd("/home/user", ".."));
    }

    @Test
    void scenario_A5() {
        assertEquals(d("L2hvbWUvdXNlci9waWNz"), solver.cd("/home/user", "./docs/../pics"));
    }

    // New: home directory support
    @Test
    void scenario_B1() {
        assertEquals(d("L2hvbWUvamVycmVk"), solver.cdWithHome("/tmp", "~", "/home/jerred"));
    }

    @Test
    void scenario_B2() {
        assertEquals(d("L2hvbWUvamVycmVkL2RvY3M="), solver.cdWithHome("/tmp", "~/docs", "/home/jerred"));
    }

    @Test
    void scenario_B3() {
        assertEquals(d("L2hvbWUvamVycmVk"), solver.cdWithHome("/anywhere", "~/docs/..", "/home/jerred"));
    }

    @Test
    void scenario_B4() {
        assertEquals(d("L3RtcC9hL34="), solver.cdWithHome("/tmp", "a/~", "/home/jerred"));
    }
}
