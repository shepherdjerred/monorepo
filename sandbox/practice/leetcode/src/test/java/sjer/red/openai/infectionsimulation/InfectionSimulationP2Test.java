package sjer.red.openai.infectionsimulation;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class InfectionSimulationP2Test {

    private final InfectionSimulationP2 sim = new InfectionSimulationP2();

    // --- Regression tests (no I cells, same behavior as P1) ---

    @Test
    void scenario_A1_regression_corner_3x3() {
        char[][] grid = {
            {'X', '.', '.'},
            {'.', '.', '.'},
            {'.', '.', '.'}
        };
        assertEquals(2, sim.simulate(grid));
    }

    @Test
    void scenario_A2_regression_all_infected() {
        char[][] grid = {
            {'X', 'X'},
            {'X', 'X'}
        };
        assertEquals(0, sim.simulate(grid));
    }

    @Test
    void scenario_A3_regression_no_infected() {
        char[][] grid = {
            {'.', '.'},
            {'.', '.'}
        };
        assertEquals(0, sim.simulate(grid));
    }

    // --- Immune cell tests ---

    @Test
    void scenario_B1_I_wall_blocks_infection() {
        // X on left, wall of I in middle column, healthy on right. Right side unreachable.
        // Grid 3x5:
        // X . I . .
        // X . I . .
        // X . I . .
        // No path from X to right side. Days = 1 (X spreads to col 1 only).
        char[][] grid = {
            {'X', '.', 'I', '.', '.'},
            {'X', '.', 'I', '.', '.'},
            {'X', '.', 'I', '.', '.'}
        };
        assertEquals(1, sim.simulate(grid));
    }

    @Test
    void scenario_B2_I_cells_surround_healthy_completely() {
        // Healthy cell at center, surrounded by I on all 8 sides. X in corner.
        // X I .
        // I I .
        // . . .
        // X spreads to (0,1)? No, (0,1) is I. (1,0)? I. (1,1)? I. So X can't spread at all.
        // Healthy cells at (0,2),(1,2),(2,0),(2,1),(2,2) are unreachable.
        char[][] grid = {
            {'X', 'I', '.'},
            {'I', 'I', '.'},
            {'.', '.', '.'}
        };
        assertEquals(0, sim.simulate(grid));
    }

    @Test
    void scenario_B3_I_cells_partial_blocking() {
        // X at (0,0), I at (0,1) and (1,0). X can only spread diagonally to (1,1).
        // From (1,1) it spreads to remaining cells.
        // Day 1: (1,1). Day 2: (0,2),(1,2),(2,0),(2,1),(2,2).
        char[][] grid = {
            {'X', 'I', '.'},
            {'I', '.', '.'},
            {'.', '.', '.'}
        };
        assertEquals(2, sim.simulate(grid));
    }

    @Test
    void scenario_B4_all_immune_except_one_X() {
        // Only X, rest I. No healthy cells to infect.
        char[][] grid = {
            {'I', 'I', 'I'},
            {'I', 'X', 'I'},
            {'I', 'I', 'I'}
        };
        assertEquals(0, sim.simulate(grid));
    }

    @Test
    void scenario_B5_I_adjacent_to_X_stays_I() {
        // I cell next to X should remain I. Healthy cell beyond I unreachable.
        // X I .
        char[][] grid = {{'X', 'I', '.'}};
        assertEquals(0, sim.simulate(grid));
    }

    @Test
    void scenario_B6_healthy_unreachable_due_to_I_wall() {
        // 3x3, X at top-left, I wall isolates bottom-right.
        // X . I
        // . I .
        // I . .
        // X(0,0) -> day1: (0,1),(1,0),(1,1)=I skip. day2: from (0,1)->(0,2)=I,(1,1)=I,(1,2); from (1,0)->(2,0)=I,(2,1),(1,1)=I.
        // So day2: (1,2),(2,1). day3: from (1,2)->(2,2); from (2,1)->(2,2) already. -> (2,2).
        // Result: 3 days.
        char[][] grid = {
            {'X', '.', 'I'},
            {'.', 'I', '.'},
            {'I', '.', '.'}
        };
        assertEquals(3, sim.simulate(grid));
    }

    @Test
    void scenario_B7_single_row_I_in_middle() {
        // X . I . .
        // X can reach pos 1. I at pos 2 blocks. Pos 3, 4 unreachable.
        char[][] grid = {{'X', '.', 'I', '.', '.'}};
        assertEquals(1, sim.simulate(grid));
    }
}
