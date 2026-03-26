package sjer.red.openai.creditsystem;

/**
 * PROBLEM: GPU Credit System v2
 * <p>
 * PART 2: Subtract Operations (cumulative ~35 minutes)
 * <p>
 * All Part 1 functionality, plus subtract operations.
 * <p>
 * - subtract(amount, time) — At the given time, deduct `amount` credits from
 *   the available balance. When multiple grants are active, credits are consumed
 *   from the grant that expires soonest first. If two grants expire at the same
 *   time, consume from the one with the lexicographically smaller grant ID first.
 *   If insufficient credits are available, the subtract fails and no credits
 *   are deducted.
 * - getBalance(time) — Return the total remaining credits at the given time,
 *   accounting for all subtracts with timestamp ≤ time. If any subtract with
 *   timestamp ≤ time was invalid (insufficient credits), return -1.
 * <p>
 * Constraints: subtract calls arrive in non-decreasing timestamp order.
 * All Part 1 constraints apply.
 * <p>
 * Example:
 *   grantCredit("a", 3, 10, 60)
 *   grantCredit("b", 2, 20, 40)
 *   subtract(1, 30)             // consumes 1 from "b" (expires at 40, before "a" at 60)
 *   getBalance(30)  → 4         // a=3, b=2-1=1 → 4
 *   getBalance(40)  → 3         // b expired, a=3
 *   subtract(3, 50)
 *   getBalance(50)  → 0         // a=3-3=0
 * <p>
 * TIME TARGET: ~20 minutes (cumulative ~35)
 */
public class CreditSystemP2 {

    public CreditSystemP2() {
        // TODO: initialize
    }

    /**
     * Register a named grant that provides credits during [startTime, endTime).
     */
    public void grantCredit(String grantId, int amount, int startTime, int endTime) {
        throw new UnsupportedOperationException();
    }

    /**
     * Deduct credits at the given time. Consume from soonest-expiring grant first.
     */
    public void subtract(int amount, int time) {
        throw new UnsupportedOperationException();
    }

    /**
     * Return the total remaining credits at the given time.
     * Returns -1 if any subtract at or before this time was invalid.
     */
    public int getBalance(int time) {
        throw new UnsupportedOperationException();
    }
}
