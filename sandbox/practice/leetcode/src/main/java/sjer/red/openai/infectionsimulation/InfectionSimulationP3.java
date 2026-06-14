package sjer.red.openai.infectionsimulation;

/**
 * PROBLEM: Infection Simulation (Grid BFS)
 * <p>
 * PART 3: Recovery After D Days (cumulative ~40-55 minutes)
 * - Same as Part 2, plus infected cells recover after `recoveryDays` days
 * - Recovered cells become 'I' (immune) and can no longer be infected or spread infection
 * - Equilibrium = no new infections AND no pending recoveries
 * - If recoveryDays is 0, infected cells immediately become immune (no spread occurs, return 0)
 * <p>
 * Examples:
 * grid = {{'.', 'X', '.'}}, recoveryDays = 2
 * Day 1: X spreads to neighbors, original X has been infected 1 day
 * Day 2: original X recovers to I, newly infected spread further
 * <p>
 * TIME TARGET: ~15-20 minutes (cumulative ~40-55)
 */
public class InfectionSimulationP3 {

    /**
     * Simulate infection spread with recovery on the grid.
     * Infected cells recover to immune ('I') after recoveryDays days.
     *
     * @param grid         2D char array where 'X' = infected, '.' = healthy, 'I' = immune
     * @param recoveryDays number of days after which an infected cell recovers to immune
     * @return number of days until equilibrium (no new infections and no pending recoveries)
     */
    public int simulate(char[][] grid, int recoveryDays) {
        // TODO: implement
        throw new UnsupportedOperationException("Not yet implemented");
    }
}
