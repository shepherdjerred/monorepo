---
title: "Letter Combinations of a Phone Number"
date: 2024-07-30Z-0700
leetcode: true
---

## Problem

Given a string containing digits from 2-9 inclusive, return all possible letter combinations that the number could represent. Return the answer in any order.

A mapping of digits to letters (just like on the telephone buttons) is given below. Note that 1 does not map to any letters.

Example 1:

```text
Input: digits = "23"
Output: ["ad","ae","af","bd","be","bf","cd","ce","cf"]
```

Example 2:

```text
Input: digits = ""
Output: []
```

Example 3:

```text
Input: digits = "2"
Output: ["a","b","c"]
```

Constraints:

- 0 <= digits.length <= 4
- digits[i] is a digit in the range ['2', '9'].

## Solution

```java
class Solution {
    public List<String> letterCombinations(String digits) {
        var ans = new ArrayList<String>();
        solve(digits, 0, "", ans);
        return ans;
    }

    public void solve(String digits, int n, String curr, List<String> ans) {
        var m = Map.of(
            '2', List.of("a", "b", "c"),
            '3', List.of("d", "e", "f"),
            '4', List.of("g", "h", "i"),
            '5', List.of("j", "k", "l"),
            '6', List.of("m", "n", "o"),
            '7', List.of("p", "q", "r", "s"),
            '8', List.of("t", "u", "v"),
            '9', List.of("w", "x", "y", "z")
        );

        if (n == digits.length()) {
            if (curr.length() > 0) {
                ans.add(curr);
            }
            return;
        }

        var number = digits.charAt(n);
        var letters = m.get(number);

        for (var l : letters) {
            solve(digits, n + 1, curr + l, ans);
        }
    }
}
```
