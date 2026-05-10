---
title: "Maximum Profit in Job Scheduling"
date: 2024-08-14Z-0700
leetcode: true
---

## Problem

We have n jobs, where every job is scheduled to be done from startTime[i] to endTime[i], obtaining a profit of profit[i].

You're given the startTime, endTime and profit arrays, return the maximum profit you can take such that there are no two jobs in the subset with overlapping time range.

If you choose a job that ends at time X you will be able to start another job that starts at time X.

Example 1:

```text
Input: startTime = [1,2,3,3], endTime = [3,4,5,6], profit = [50,10,40,70]
Output: 120
Explanation: The subset chosen is the first and fourth job.
Time range [1-3]+[3-6] , we get profit of 120 = 50 + 70.
```

Example 2:

```text
Input: startTime = [1,2,3,4,6], endTime = [3,5,10,6,9], profit = [20,20,100,70,60]
Output: 150
Explanation: The subset chosen is the first, fourth and fifth job.
Profit obtained 150 = 20 + 70 + 60.
```

Example 3:

```text
Input: startTime = [1,1,1], endTime = [2,3,4], profit = [5,6,4]
Output: 6
```

Constraints:

- 1 <= startTime.length == endTime.length == profit.length <= 5 \* 104
- 1 <= startTime[i] < endTime[i] <= 109
- 1 <= profit[i] <= 104

## Solution

### Sorting

Unoptimized

Time: O(n^2)

Space: O(n)

```java
class Solution {
    record Pair(int end, int profit){}

    public int jobScheduling(int[] startTime, int[] endTime, int[] profits) {
        // transform the input
        var input = new int[startTime.length][3];

        for (var i = 0; i < startTime.length; i++) {
            input[i] = new int[]{startTime[i], endTime[i], profits[i]};
        }

        // sort
        Arrays.sort(input, (l, r) -> Integer.compare(l[0], r[0]));

        // at each step, we want to know if we could extend a previous choice
        // mapping of end time -> profit
        var m = new HashMap<Integer, Integer>();

        var ans = 0;

        for (var i = 0; i < input.length; i++) {
            var start = input[i][0];
            var end = input[i][1];
            var profit = input[i][2];

            var best = 0;

            // find the best choice
            for (var entry : m.entrySet()) {
                if (entry.getKey() <= start) {
                    best = Math.max(entry.getValue(), best);
                }
            }

            var total = best + profit;
            m.compute(end, (k, v) -> v == null ? total : Math.max(v, total));
            ans = Math.max(total, ans);
        }

        return ans;
    }
}
```

### Priority Queue

Time: O(n \* log(n))
Space: O(n)

```java
class Solution {
    record Pair(int end, int profit){}

    public int jobScheduling(int[] startTime, int[] endTime, int[] profits) {
        // transform the input
        var input = new int[startTime.length][3];

        for (var i = 0; i < startTime.length; i++) {
            input[i] = new int[]{startTime[i], endTime[i], profits[i]};
        }

        // sort
        Arrays.sort(input, (l, r) -> Integer.compare(l[0], r[0]));

        var pq = new PriorityQueue<Pair>((l, r) -> Integer.compare(l.end, r.end));

        var best = 0;

        // iterate
        for (var i = 0; i < input.length; i++) {
            var start = input[i][0];
            var end = input[i][1];
            var profit = input[i][2];

            // see if we can use the profit of a previous interval
            // we'll need to know the end time of previous intervals to know
            // if they're valid
            // we need efficient lookup

            // look into the pq at all valid solutions
            while (!pq.isEmpty() && pq.peek().end <= start) {
                // best will _always_ have the most profit we could have
                // previously made at the current start time
                best = Math.max(pq.poll().profit, best);
            }

            pq.add(new Pair(end, profit + best));
        }

        while (!pq.isEmpty()) {
            best = Math.max(pq.poll().profit, best);
        }

        return best;
    }
}
```
