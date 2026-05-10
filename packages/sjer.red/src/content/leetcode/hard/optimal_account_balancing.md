---
title: "Optimal Account Balancing"
date: 2024-08-14Z-0700
leetcode: true
---

## Problem

You are given an array of transactions transactions where transactions[i] = [fromi, toi, amounti] indicates that the person with ID = fromi gave amounti $ to the person with ID = toi.

Return the minimum number of transactions required to settle the debt.

Example 1:

```text
Input: transactions = [[0,1,10],[2,0,5]]
Output: 2
Explanation:
Person #0 gave person #1 $10.
Person #2 gave person #0 $5.
Two transactions are needed. One way to settle the debt is person #1 pays person #0 and #2 $5 each.
```

Example 2:

```text
Input: transactions = [[0,1,10],[1,0,1],[1,2,5],[2,0,5]]
Output: 1
Explanation:
Person #0 gave person #1 $10.
Person #1 gave person #0 $1.
Person #1 gave person #2 $5.
Person #2 gave person #0 $5.
Therefore, person #1 only need to give person #0 $4, and all debt is settled.
```

Constraints:

- 1 <= transactions.length <= 8
- transactions[i].length == 3
- 0 <= fromi, toi < 12
- fromi != toi
- 1 <= amounti <= 100

## Solution

### Backtracking

```java
class Solution {
    public int minTransfers(int[][] transactions) {
        var balances = new int[12];

        for (var tx : transactions) {
            balances[tx[0]] -= tx[2];
            balances[tx[1]] += tx[2];
        }

        return backtrack(balances, 0, 0);
    }

    public int backtrack(int[] balances, int pos, int txs) {
        if (pos >= balances.length) {
            return txs;
        }

        // only try to balance negative accounts
        // the total money in the system is zero-sum so if we handle the negatives we know there will be no positives
        if (balances[pos] >= 0) {
            return backtrack(balances, pos + 1, txs);
        }

        var results = new ArrayList<Integer>();

        // see who can give us $$$
        for (var i = 0; i < balances.length; i++) {
            if (balances[i] > 0) {
                // try to take their money
                var copy = Arrays.copyOf(balances, balances.length);
                copy[pos] += copy[i];
                copy[i] = 0;
                results.add(backtrack(copy, pos, txs + 1));
            }
        }

        return results.stream().reduce(Math::min).orElse(-1);
    }
}
```

### Greedy w/ Priority Queue

This is a greedy solution that doesn't always return the ideal solution.

```java
class Solution {
    public int minTransfers(int[][] transactions) {
        var moves = 0;
        var balance = new int[12];
        for (var t : transactions) {
            balance[t[0]] -= t[2];
            balance[t[1]] += t[2];
        }

        // stores indexes
        var debts = new PriorityQueue<Integer>((l, r) -> {
            return Integer.compare(balance[l], balance[r]);
        });
        var credits = new PriorityQueue<Integer>((l, r) -> {
            return Integer.compare(balance[r], balance[l]);
        });

        for (var i = 0; i < 12; i++) {
            // ignore anyone who is already balanced
            if (balance[i] > 0) {
                credits.offer(i);
            }
            if (balance[i] < 0) {
                debts.offer(i);
            }
        }

        while (!debts.isEmpty() && !credits.isEmpty()) {
            var richest = credits.poll();
            var poorest = debts.poll();

            var diff = balance[richest] + balance[poorest];
            if (diff >= 0) {
                // richest can pay off the entire debt
                balance[richest] += balance[poorest];
                balance[poorest] = 0;
                // re-add richest if they still have money
                if (balance[richest] > 0) {
                    credits.offer(richest);
                }
            } else {
                balance[poorest] += balance[richest];
                // don't re-add richest (they're balanced)
                // re-add poorest
                debts.offer(poorest);
            }

            moves += 1;
        }

        return moves;
    }
}
```

### Greedy w/ Pairs

This is a version of the above that finds pairs which would cancel out accounts. It still doesn't provide the optimal solution

```java
class Solution {
    public int minTransfers(int[][] transactions) {
        var moves = 0;
        var balance = new int[12];
        for (var t : transactions) {
            balance[t[0]] -= t[2];
            balance[t[1]] += t[2];
        }

        // stores indexes
        var debts = new PriorityQueue<Integer>((l, r) -> {
            return Integer.compare(balance[l], balance[r]);
        });
        var credits = new PriorityQueue<Integer>((l, r) -> {
            return Integer.compare(balance[r], balance[l]);
        });

        for (var i = 0; i < 12; i++) {
            // ignore anyone who is already balanced
            if (balance[i] > 0) {
                credits.offer(i);
            }
            if (balance[i] < 0) {
                debts.offer(i);
            }
        }

        while (!debts.isEmpty() && !credits.isEmpty()) {
            var richest = credits.poll();
            var poorest = debts.poll();

            // check if there is anyone that would perfectly cancel out these accounts
            int poorestPartner = -1;
            for (var i = 0; i < balance.length; i++) {
                if (balance[i] * -1 == balance[poorest]) {
                    poorestPartner = i;
                    break;
                }
            }
            if (poorestPartner >= 0) {
                credits.offer(richest);
                credits.remove(poorestPartner);
                balance[poorest] = 0;
                balance[poorestPartner] = 0;
                moves += 1;
                continue;
            }

            int richestPartner = -1;
            for (var i = 0; i < balance.length; i++) {
                if (balance[i] * -1 == balance[richest]) {
                    richestPartner = i;
                    break;
                }
            }
            if (richestPartner >= 0) {
                debts.offer(poorest);
                debts.remove(richestPartner);
                balance[richest] = 0;
                balance[richestPartner] = 0;
                moves += 1;
                continue;
            }

            var diff = balance[richest] + balance[poorest];
            if (diff >= 0) {
                // richest can pay off the entire debt
                balance[richest] += balance[poorest];
                balance[poorest] = 0;
                // re-add richest if they still have money
                if (balance[richest] > 0) {
                    credits.offer(richest);
                }
            } else {
                balance[poorest] += balance[richest];
                balance[richest] = 0;
                // don't re-add richest (they're balanced)
                // re-add poorest
                debts.offer(poorest);
            }

            moves += 1;
        }

        System.out.println(debts);
        System.out.println(credits);

        return moves;
    }
}
```
