package sjer.red.openai.cddirectory;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.Base64;

import static org.junit.jupiter.api.Assertions.assertEquals;

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
        assertEquals(d("L2hvbWUvdXNlci9kb2Nz"), solver.cd("/home/user", "docs"));
    }

    @Test
    void scenario_A2() {
        assertEquals(d("L2hvbWU="), solver.cd("/home/user", ".."));
    }

    @Test
    void scenario_A3() {
        assertEquals(d("Lw=="), solver.cd("/", ".."));
    }

    @Test
    void scenario_A4() {
        assertEquals(d("L2V0Yw=="), solver.cd("/home/user", "/etc"));
    }

    @Test
    void scenario_A5() {
        assertEquals(d("L2hvbWUvdXNlci9waWNz"), solver.cd("/home/user", "./docs/../pics"));
    }

    @Test
    void scenario_A6() {
        assertEquals(d("Lw=="), solver.cd("/a/b/c", "../../.."));
    }

    @Test
    void scenario_A7() {
        assertEquals(d("L2EvYi9j"), solver.cd("/a/b/c", "."));
    }

    @Test
    void scenario_A8() {
        assertEquals(d("L3gveQ=="), solver.cd("/a", "/x/y/z/.."));
    }

    @Test
    void scenario_A9() {
        assertEquals(d("L2E="), solver.cd("/a/b/c/d/e", "../../../.."));
    }

    @Test
    void scenario_A10() {
        assertEquals(d("L2EvYg=="), solver.cd("/a", "b"));
    }

    @Test
    void scenario_A11() {
        assertEquals(d("Lw=="), solver.cd("/home/user", "/"));
    }

    @Test
    void scenario_A12() {
        assertEquals(d("Lw=="), solver.cd("/a", "../../../.."));
    }

    @Test
    void scenario_A13() {
        assertEquals(d("L2M="), solver.cd("/a/b", "./../.././c"));
    }

    @Test
    void scenario_A14() {
        assertEquals(d("L2EvYg=="), solver.cd("/", "a/b"));
    }

    @Test
    void scenario_A15() {
        assertEquals(d("Lw=="), solver.cd("/a", ".."));
    }

    @Test
    void scenario_A16() {
        assertEquals(d("L2EvYi9jL2QvZS9mL2cvaA=="), solver.cd("/", "a/b/c/d/e/f/g/h"));
    }
}
