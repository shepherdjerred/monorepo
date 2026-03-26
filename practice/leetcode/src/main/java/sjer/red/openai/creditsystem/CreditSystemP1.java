package sjer.red.openai.creditsystem;

/**
 * PROBLEM: GPU Credit System v2
 * <p>
 * PART 1: Named Grants and Point-in-Time Balance
 * <p>
 * You are building a system that tracks GPU credit grants. Each grant has a
 * unique string ID, a credit amount, and a time window during which it is active.
 * <p>
 * - grantCredit(grantId, amount, startTime, endTime) — Register a grant.
 *   The grant provides `amount` credits during the time window [startTime, endTime).
 * - getBalance(time) — Return the total credits available at the given time.
 * <p>
 * Constraints: grant IDs are unique. startTime < endTime. Amounts are positive.
 * <p>
 * Example:
 *   grantCredit("a", 3, 10, 60)
 *   getBalance(10)  → 3
 *   getBalance(9)   → 0
 *   getBalance(60)  → 0
 *   grantCredit("b", 2, 20, 40)
 *   getBalance(25)  → 5
 *   getBalance(45)  → 3
 * <p>
 * TIME TARGET: ~15 minutes
 */
public class CreditSystemP1 {

    public CreditSystemP1() {
        // TODO: initialize
    }

    /**
     * Register a named grant that provides credits during [startTime, endTime).
     */
    public void grantCredit(String grantId, int amount, int startTime, int endTime) {
        throw new UnsupportedOperationException();
    }

    /**
     * Return the total credits available at the given time.
     */
    public int getBalance(int time) {
        throw new UnsupportedOperationException();
    }
}
