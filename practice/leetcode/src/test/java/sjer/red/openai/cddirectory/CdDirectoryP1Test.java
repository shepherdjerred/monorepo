package sjer.red.openai.cddirectory;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.Base64;

import static org.junit.jupiter.api.Assertions.assertTrue;

class CdDirectoryP1Test {
    private CdDirectoryP1 solver;

    private static String d(String b64) {
        return new String(Base64.getDecoder().decode(b64), StandardCharsets.UTF_8);
    }

    @BeforeEach
    void setUp() {
        solver = new CdDirectoryP1();
    }

    @Test
    void scenario_A1() {
        assertTrue(d("L2hvbWUvdXNlci9kb2Nz").equals(solver.cd("/home/user", "docs")));
    }

    @Test
    void scenario_A2() {
        assertTrue(d("L2hvbWU=").equals(solver.cd("/home/user", "..")));
    }

    @Test
    void scenario_A3() {
        assertTrue(d("Lw==").equals(solver.cd("/", "..")));
    }

    @Test
    void scenario_A4() {
        assertTrue(d("L2V0Yw==").equals(solver.cd("/home/user", "/etc")));
    }

    @Test
    void scenario_A5() {
        assertTrue(d("L2hvbWUvdXNlci9waWNz").equals(solver.cd("/home/user", "./docs/../pics")));
    }

    @Test
    void scenario_A6() {
        assertTrue(d("Lw==").equals(solver.cd("/a/b/c", "../../..")));
    }

    @Test
    void scenario_A7() {
        assertTrue(d("L2EvYi9j").equals(solver.cd("/a/b/c", ".")));
    }

    @Test
    void scenario_A8() {
        assertTrue(d("L3gveQ==").equals(solver.cd("/a", "/x/y/z/..")));
    }

    @Test
    void scenario_A9() {
        assertTrue(d("L2E=").equals(solver.cd("/a/b/c/d/e", "../../../..")));
    }

    @Test
    void scenario_A10() {
        assertTrue(d("L2EvYg==").equals(solver.cd("/a", "b")));
    }

    @Test
    void scenario_A11() {
        assertTrue(d("Lw==").equals(solver.cd("/home/user", "/")));
    }

    @Test
    void scenario_A12() {
        assertTrue(d("Lw==").equals(solver.cd("/a", "../../../..")));
    }

    @Test
    void scenario_A13() {
        assertTrue(d("L2M=").equals(solver.cd("/a/b", "./../.././c")));
    }

    @Test
    void scenario_A14() {
        assertTrue(d("L2EvYg==").equals(solver.cd("/", "a/b")));
    }

    @Test
    void scenario_A15() {
        assertTrue(d("Lw==").equals(solver.cd("/a", "..")));
    }

    @Test
    void scenario_A16() {
        assertTrue(d("L2EvYi9jL2QvZS9mL2cvaA==").equals(solver.cd("/", "a/b/c/d/e/f/g/h")));
    }
}
