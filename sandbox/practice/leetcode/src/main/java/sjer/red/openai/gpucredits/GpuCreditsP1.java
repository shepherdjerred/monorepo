package sjer.red.openai.gpucredits;

import java.util.ArrayList;
import java.util.List;

/**
 * PROBLEM: GPU Credit Tracking
 * <p>
 * PART 1: Basic Credit Operations
 * - addCredit(time, expireTime, amount) — add `amount` credits at `time` that expire at `expireTime`
 * - processCost(time, amount) — at `time`, try to deduct `amount` credits
 * - Return true if enough non-expired credits are available, false otherwise
 * - If false, no credits should be deducted (atomic: no partial deduction on failure)
 * - availableCredits(time) — return total non-expired credits available at `time`
 * <p>
 * Examples:
 * addCredit(t=0, expire=10, amount=100)
 * processCost(t=1, amount=50) → true
 * availableCredits(t=1) → 50
 * <p>
 * TIME TARGET: ~10-15 minutes
 */
public class GpuCreditsP1 {
    // part one done in 13min

    List<Credit> credits = new ArrayList<>();

    /**
     * Add credits that become available at `time` and expire at `expireTime`.
     */
    public void addCredit(int time, int expireTime, int amount) {
        credits.add(new Credit(time, expireTime, amount));
    }

    /**
     * Try to deduct `amount` credits at the given `time`.
     * If insufficient credits, return false and deduct nothing.
     *
     * @return true if the cost was successfully processed
     */
    public boolean processCost(int time, int amount) {
        var canAfford = availableCredits(time) >= amount;
        if (!canAfford) {
            return false;
        }

        while (amount > 0 && !credits.isEmpty()) {
            var credit = credits.getFirst();

            // check if credits have expired or are empty
            if (credit.expire <= time || credit.amount == 0) {
                credits.removeFirst();
            } else {
                // cases
                // they have enough in this grant
                // possibly could simplify this?
                if (credit.amount >= amount) {
                    credit.amount -= amount;
                    amount = 0;
                } else {
                    amount -= credit.amount;
                    credit.amount = 0;
                }

                // remove credit if it is now exhausted
                if (credit.amount == 0) {
                    credits.removeFirst();
                }
            }
        }

        return true;
    }

    /**
     * Return the total non-expired credits available at the given time.
     */
    public int availableCredits(int time) {
        return credits.stream().filter(credit -> credit.expire > time).map(credit -> credit.amount).reduce(Integer::sum).orElse(0);
    }

    class Credit {
        Integer time;
        Integer expire;
        Integer amount;

        Credit(Integer time, Integer expire, Integer amount) {
            this.time = time;
            this.expire = expire;
            this.amount = amount;
        }
    }
}
