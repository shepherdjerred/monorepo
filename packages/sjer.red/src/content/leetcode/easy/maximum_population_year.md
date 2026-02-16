---
title: "Maximum Population Year"
date: 2024-08-07Z-0700
leetcode: true
---

## Problem

You are given a 2D integer array logs where each logs[i] = [birthi, deathi] indicates the birth and death years of the ith person.

The population of some year x is the number of people alive during that year. The ith person is counted in year x's population if x is in the inclusive range [birthi, deathi - 1]. Note that the person is not counted in the year that they die.

Return the earliest year with the maximum population.

Example 1:

```text
Input: logs = [[1993,1999],[2000,2010]]
Output: 1993
Explanation: The maximum population is 1, and 1993 is the earliest year with this population.
```

Example 2:

```text
Input: logs = [[1950,1961],[1960,1971],[1970,1981]]
Output: 1960
Explanation:
The maximum population is 2, and it had happened in years 1960 and 1970.
The earlier year between them is 1960.
```

Constraints:

- 1 <= logs.length <= 100
- 1950 <= birthi < deathi <= 2050

## Solution

### Using a fixed-size array

Time: o(n)
Space: O(1)

```java
class Solution {
    public int maximumPopulation(int[][] logs) {
        var yrs = new int[2050 - 1950 + 1];
        for (var l : logs) {
            yrs[l[0] - 1950] += 1;
            yrs[l[1] - 1950] -= 1;
        }

        var maxIdx = 0;
        var maxPop = 0;
        var pop = 0;
        for (var i = 0; i < yrs.length; i++) {
            var newPop = pop + yrs[i];
            if (newPop > pop && newPop > maxPop) {
                maxIdx = i;
                maxPop = newPop;
            }
            pop = newPop;
        }
        return maxIdx + 1950;
    }
}
```

### Using a TreeMap

Time: O(log(n))
Space: O(n)

```java
class Solution {
    public int maximumPopulation(int[][] logs) {
        var yrs = new TreeMap<Integer, Integer>();
        for (var l : logs) {
            yrs.merge(l[0], 1, Integer::sum);
            yrs.merge(l[1], -1, Integer::sum);
        }

        var maxYr = 0;
        var maxPop = 0;
        var pop = 0;
        for (var yr : yrs.entrySet()) {
            var newPop = pop + yr.getValue();
            if (newPop > pop && newPop > maxPop) {
                maxYr = yr.getKey();
                maxPop = newPop;
            }
            pop = newPop;
        }
        return maxYr;
    }
}
```
