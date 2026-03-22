package sjer.red.openai.infectionsimulation;

/**
 * PROBLEM: Infection Simulation (Grid BFS)
 * SOURCE: From Shuxin
 * <p>
 * PART 1: Basic Infection Spread
 * - int simulate(char[][] grid) — return number of days until equilibrium
 * - Grid: 'X' = infected, '.' = healthy
 * - 8-directional spread (all 8 neighbors)
 * - Newly infected cells spread next day
 * - Return 0 if already at equilibrium (no healthy neighbors of infected cells, or no infected cells)
 * <p>
 * Examples:
 * grid = {{'X', '.', '.'}, {'.', '.', '.'}, {'.', '.', '.'}}
 * X in top-left corner of 3x3 → returns 2
 * <p>
 * grid = {{'.', '.', '.'}, {'.', 'X', '.'}, {'.', '.', '.'}}
 * X in center of 3x3 → returns 1 (all 8 neighbors infected in one day)
 * <p>
 * KEY INSIGHT: Multi-source BFS. Seed queue with all initial 'X' cells, process layer by layer.
 * TIME TARGET: ~15-20 minutes
 */
public class InfectionSimulationP1 {

    /**
     * Simulate infection spread on the grid and return the number of days until equilibrium.
     * Infection spreads in all 8 directions. Newly infected cells spread the next day.
     *
     * @param grid 2D char array where 'X' = infected, '.' = healthy
     * @return number of days until no new infections occur
     */
    public int simulate(char[][] grid) {
        // TODO: implement
        throw new UnsupportedOperationException("Not yet implemented");
    }
}
