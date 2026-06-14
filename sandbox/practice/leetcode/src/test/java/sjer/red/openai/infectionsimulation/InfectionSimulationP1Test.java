package sjer.red.openai.infectionsimulation;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class InfectionSimulationP1Test {

    private final InfectionSimulationP1 sim = new InfectionSimulationP1();

    @Test
    void scenario_A1_single_X_in_corner_3x3() {
        // X at (0,0). Day 1: (0,1),(1,0),(1,1). Day 2: (0,2),(2,0),(2,1),(2,2),(1,2).
        char[][] grid = {
            {'X', '.', '.'},
            {'.', '.', '.'},
            {'.', '.', '.'}
        };
        assertEquals(2, sim.simulate(grid));
    }

    @Test
    void scenario_A2_already_fully_infected() {
        char[][] grid = {
            {'X', 'X'},
            {'X', 'X'}
        };
        assertEquals(0, sim.simulate(grid));
    }

    @Test
    void scenario_A3_no_infected_cells() {
        char[][] grid = {
            {'.', '.'},
            {'.', '.'}
        };
        assertEquals(0, sim.simulate(grid));
    }

    @Test
    void scenario_A4_single_X_center_3x3() {
        // X at (1,1). All 8 neighbors infected in 1 day.
        char[][] grid = {
            {'.', '.', '.'},
            {'.', 'X', '.'},
            {'.', '.', '.'}
        };
        assertEquals(1, sim.simulate(grid));
    }

    @Test
    void scenario_A5_1x1_grid_with_X() {
        char[][] grid = {{'X'}};
        assertEquals(0, sim.simulate(grid));
    }

    @Test
    void scenario_A6_1x1_grid_with_dot() {
        char[][] grid = {{'.'}};
        assertEquals(0, sim.simulate(grid));
    }

    @Test
    void scenario_A7_line_of_dots_X_at_one_end() {
        // 1x6 grid: X.....  8-directional on single row = only horizontal neighbors.
        // Day 1: pos 1, Day 2: pos 2, ..., Day 5: pos 5.
        char[][] grid = {{'X', '.', '.', '.', '.', '.'}};
        assertEquals(5, sim.simulate(grid));
    }

    @Test
    void scenario_A8_5x5_X_in_center() {
        // X at (2,2). Chebyshev distance to any corner is 2. All cells within 2 days.
        char[][] grid = {
            {'.', '.', '.', '.', '.'},
            {'.', '.', '.', '.', '.'},
            {'.', '.', 'X', '.', '.'},
            {'.', '.', '.', '.', '.'},
            {'.', '.', '.', '.', '.'}
        };
        assertEquals(2, sim.simulate(grid));
    }

    @Test
    void scenario_A9_two_X_opposite_corners() {
        // 4x4, X at (0,0) and (3,3). Farthest cell from any source: (0,3) or (3,0) at Chebyshev dist 3.
        char[][] grid = {
            {'X', '.', '.', '.'},
            {'.', '.', '.', '.'},
            {'.', '.', '.', '.'},
            {'.', '.', '.', 'X'}
        };
        assertEquals(3, sim.simulate(grid));
    }

    @Test
    void scenario_A10_rectangular_grid() {
        // 2x5, X at (0,0). Farthest: (1,4), Chebyshev distance = max(1,4) = 4.
        char[][] grid = {
            {'X', '.', '.', '.', '.'},
            {'.', '.', '.', '.', '.'}
        };
        assertEquals(4, sim.simulate(grid));
    }
}
