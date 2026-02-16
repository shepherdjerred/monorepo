---
title: "Combinations"
date: 2024-07-28Z-0700
leetcode: true
---

## Problem

Given two integers n and k, return all possible combinations of k numbers chosen from the range [1, n].

You may return the answer in any order.

Example 1:

```text
Input: n = 4, k = 2
Output: [[1,2],[1,3],[1,4],[2,3],[2,4],[3,4]]
Explanation: There are 4 choose 2 = 6 total combinations.
Note that combinations are unordered, i.e., [1,2] and [2,1] are considered to be the same combination.
```

Example 2:

```text
Input: n = 1, k = 1
Output: [[1]]
Explanation: There is 1 choose 1 = 1 total combination.
```

Constraints:

- 1 <= n <= 20
- 1 <= k <= n

## Solution

### Another Backtracking

Time: O(n! / (n - k) \* k!)
Space: O(k)

This implementation is worse because I'm using a `contains` check to avoid duplicates. My prior approach was better since it used a separate variable. Alternatively, a set would also be okay, though it would require a set -> list conversion step.

```java
class Solution {
    public List<List<Integer>> combine(int n, int k) {
        var ans = new ArrayList<List<Integer>>();
        solve(n, k, List.of(), ans);
        return ans;
    }

    void solve(int n, int k, List<Integer> curr, List<List<Integer>> ans) {
        if (curr.size() == k) {
            ans.add(curr);
            return;
        }

        for (var i = 1; i <= n; i++) {
            if (curr.contains(i)) {
                continue;
            }
            var l = new ArrayList<>(curr);
            l.add(i);
            solve(i, k, l, ans);
        }
    }
}
```

### Backtracking

Time: O(n! / (n - k)!)
Space: O(n)

```java
class Solution {
    public List<List<Integer>> combine(int n, int k) {
        var ans = new ArrayList<List<Integer>>();
        solve(n, k, 1, List.of(), ans);
        return ans;
    }

    public void solve(int n, int k, int x, List<Integer> curr, List<List<Integer>> ans) {
        if (k == 0) {
            ans.add(curr);
            return;
        }

        // choose one from n
        for (var i = x; i <= n; i++) {
            var copy = new ArrayList<>(curr);
            copy.add(i);
            solve(n, k - 1, i + 1, copy, ans);
        }
    }
}
```
