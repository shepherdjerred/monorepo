package sjer.red.openai.gpucredits;

import java.util.ArrayList;
import java.util.List;

/**
 * PROBLEM: GPU Credit Tracking
 * <p>
 * PART 3: Expiration Handling (cumulative ~30-45 minutes)
 * - All Part 1 & 2 functionality, plus:
 * - Expired credits automatically excluded from availability and consumption
 * - Handle mixed expiration across batches
 * - Track remaining amounts per batch correctly after partial consumption
 * <p>
 * Example:
 * addCredit(t=0, expire=10, amount=50)
 * addCredit(t=1, expire=5, amount=30)
 * processCost(t=2, amount=60) → true (takes 50 from batch 0, 10 from batch 1)
 * processCost(t=2, amount=25) → false (only 20 remain in batch 1)
 * processCost(t=2, amount=20) → true
 * processCost(t=6, amount=1) → false (batch 1 expired, nothing left)
 * <p>
 * TIME TARGET: ~10-15 minutes (cumulative ~30-45)
 */
public class GpuCreditsP3 {
    // part 3 was already implemented in part 1

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
