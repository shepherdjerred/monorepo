---
title: "Combination Sum II"
date: 2024-07-31Z-0700
leetcode: true
---

## Problem

Given a collection of candidate numbers (candidates) and a target number (target), find all unique combinations in candidates where the candidate numbers sum to target.

Each number in candidates may only be used once in the combination.

Note: The solution set must not contain duplicate combinations.

Example 1:

```text
Input: candidates = [10,1,2,7,6,1,5], target = 8
Output:
[
    [1,1,6],
    [1,2,5],
    [1,7],
    [2,6]
]
```

Example 2:

```text
Input: candidates = [2,5,2,1,2], target = 5
Output:
[
    [1,2,2],
    [5]
]
```

Constraints:

- 1 <= candidates.length <= 100
- 1 <= candidates[i] <= 50
- 1 <= target <= 30

## Solution

```java
class Solution {
    public List<List<Integer>> combinationSum2(int[] candidates, int target) {
        var ans = new ArrayList<List<Integer>>();
        var counter = new HashMap<Integer, Integer>();
        for (var i : candidates) {
            counter.merge(i, 1, Integer::sum);
        }
        solve(counter, target, List.of(), ans);
        return ans;
    }

    public void solve(Map<Integer, Integer> m, int target, List<Integer> curr, List<List<Integer>> ans) {
        var sum = curr.stream().reduce(Integer::sum).orElse(0);
        if (sum == target) {
            ans.add(curr);
            return;
        }

        if (m.isEmpty()) {
            return;
        }

        var next = m.entrySet().iterator().next();

        // two options: take some/all or take none

        // case: none:
        var newMap = new HashMap<>(m);
        newMap.remove(next.getKey());

        solve(newMap, target, curr, ans);

        // case: some/all
        var l = new ArrayList<>(curr);
        var acc = sum;
        for (int i = 0; i < next.getValue(); i++) {
            if (acc + next.getKey() <= target) {
                acc += next.getKey();
                l.add(next.getKey());
                solve(newMap, target, l, ans);
            }
        }
    }
}
```
