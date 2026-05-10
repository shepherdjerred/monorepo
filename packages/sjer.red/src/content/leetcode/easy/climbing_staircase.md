---
title: "Climbing Staircase"
date: 2024-07-21Z-0700
leetcode: true
---

## Problem

You are climbing a staircase. It takes n steps to reach the top.

Each time you can either climb 1 or 2 steps. In how many distinct ways can you climb to the top?

Example 1:

```text
Input: n = 2
Output: 2
Explanation: There are two ways to climb to the top.

1. 1 step + 1 step
2. 2 steps
```

Example 2:

```text
Input: n = 3
Output: 3
Explanation: There are three ways to climb to the top.

1. 1 step + 1 step + 1 step
2. 1 step + 2 steps
3. 2 steps + 1 step
```

Constraints:

- 1 <= n <= 45

## Solution

I remember doing this problem during undergrad/when studying for my AWS internship interviews. I remember the solution being pretty simple after discovering it. I know that it involves dynamic programming (this problem is in the DP category after all).

```java
class Solution {
    public int climbStairs(int n) {
        return climbStairs(n, new HashMap<>());
    }

    public int climbStairs(int n, Map<Integer, Integer> m) {
        if (n < 3) {
            return n;
        }
        if (!m.containsKey(n)) {
            m.put(n, climbStairs(n - 1, m) + climbStairs(n - 2, m));
        }

        return m.get(n);
    }
}
```
