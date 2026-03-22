package sjer.red.openai.infectionsimulation;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Processing model for P3:
 * <p>
 * Each day (starting from day 1):
 *   1. All currently infected cells spread to healthy neighbors (8-directional). 'I' cells cannot be infected.
 *   2. Cells that have been infected for exactly `recoveryDays` days recover to 'I'.
 *      (Initial 'X' cells are considered infected at day 0, so they recover on day `recoveryDays`.)
 * <p>
 * Return the total number of days simulated until the grid reaches equilibrium:
 *   - Equilibrium = no new infections occurred AND no infected cells remain (all recovered or immune).
 * <p>
 * Special case: recoveryDays = 0 means all infected cells are immediately immune before any spread. Return 0.
 */
class InfectionSimulationP3Test {

    private final InfectionSimulationP3 sim = new InfectionSimulationP3();

    // --- Regression: large recoveryDays so no cell recovers during simulation ---

    @Test
    void scenario_A1_large_recovery_behaves_like_P1() {
        // 3x3, X in corner. P1 answer = 2. With large recovery, all cells infected by day 2,
        // then they must still recover. Last recovery at day 1000+2. Total days = 1002.
        // Actually: equilibrium = no infected remain. Initial X infected at day 0 recovers at day 1000.
        // Cells infected day 1 recover at 1001. Cells infected day 2 recover at 1002.
        char[][] grid = {
            {'X', '.', '.'},
            {'.', '.', '.'},
            {'.', '.', '.'}
        };
        assertEquals(1002, sim.simulate(grid, 1000));
    }

    @Test
    void scenario_A2_large_recovery_already_all_infected() {
        // All X, recovery at 1000. No new infections. All cells recover on day 1000.
        char[][] grid = {
            {'X', 'X'},
            {'X', 'X'}
        };
        assertEquals(1000, sim.simulate(grid, 1000));
    }

    // --- Recovery dynamics ---

    @Test
    void scenario_B1_recovery_1_single_cell() {
        // 1x1 X, recoveryDays=1. No spread possible. Day 1: spread (nothing), recover X. Equilibrium.
        char[][] grid = {{'X'}};
        assertEquals(1, sim.simulate(grid, 1));
    }

    @Test
    void scenario_B2_recovery_1_line() {
        // X . .  recoveryDays=1
        // Day 1: X(0) spreads to pos 1. X(0) recovers (age 1). State: I X .
        // Day 2: X(1) spreads to pos 2. X(1) recovers. State: I I X
        // Day 3: X(2) no healthy neighbors. X(2) recovers. State: I I I. Equilibrium.
        char[][] grid = {{'X', '.', '.'}};
        assertEquals(3, sim.simulate(grid, 1));
    }

    @Test
    void scenario_B3_recovery_2_line() {
        // X . .  recoveryDays=2
        // Day 1: X(0) spreads to pos 1. No recovery yet. State: X X .
        // Day 2: X(0),X(1) spread. pos 2 infected. X(0) recovers (age 2). State: I X X
        // Day 3: X(1),X(2) spread—no new healthy. X(1) recovers (age 2). State: I I X
        // Day 4: X(2) no spread. X(2) recovers. State: I I I. Equilibrium.
        char[][] grid = {{'X', '.', '.'}};
        assertEquals(4, sim.simulate(grid, 2));
    }

    @Test
    void scenario_B4_recovery_very_large_no_infected() {
        // No infected cells at all. Return 0 regardless of recoveryDays.
        char[][] grid = {{'.', '.', '.'}};
        assertEquals(0, sim.simulate(grid, 5));
    }

    @Test
    void scenario_B5_recovery_0_immediate_immune() {
        // recoveryDays=0: all X immediately become I before spread. Return 0.
        char[][] grid = {
            {'X', '.', '.'},
            {'.', '.', '.'}
        };
        assertEquals(0, sim.simulate(grid, 0));
    }

    @Test
    void scenario_B6_all_cells_become_immune() {
        // 1x2: X .  recoveryDays=1
        // Day 1: X(0) spreads to pos 1. X(0) recovers. State: I X
        // Day 2: X(1) no healthy neighbors. X(1) recovers. State: I I. Equilibrium.
        char[][] grid = {{'X', '.'}};
        assertEquals(2, sim.simulate(grid, 1));
    }

    @Test
    void scenario_B7_recovery_with_immune_cells() {
        // X I .  recoveryDays=1
        // Day 1: X(0) tries to spread. pos 1 = I (skip), no other neighbors. X(0) recovers. State: I I .
        // No infected remain. Equilibrium. Healthy cell at pos 2 is unreachable.
        char[][] grid = {{'X', 'I', '.'}};
        assertEquals(1, sim.simulate(grid, 1));
    }

    @Test
    void scenario_B8_recovery_2d_grid() {
        // 3x3, X in center, recoveryDays=1
        // Day 1: X(1,1) spreads to all 8 neighbors. X(1,1) recovers. 8 new infections.
        // Day 2: 8 infected cells have no healthy neighbors. All 8 recover. Equilibrium.
        char[][] grid = {
            {'.', '.', '.'},
            {'.', 'X', '.'},
            {'.', '.', '.'}
        };
        assertEquals(2, sim.simulate(grid, 1));
    }
}
