---
title: "Best Time to Buy and Sell Stock"
date: 2024-07-21Z-0700
leetcode: true
---

## Problem

You are given an array prices where prices[i] is the price of a given stock on the ith day.

You want to maximize your profit by choosing a single day to buy one stock and choosing a different day in the future to sell that stock.

Return the maximum profit you can achieve from this transaction. If you cannot achieve any profit, return 0.

Example 1:

```text
Input: prices = [7,1,5,3,6,4]
Output: 5
Explanation: Buy on day 2 (price = 1) and sell on day 5 (price = 6), profit = 6-1 = 5.
Note that buying on day 2 and selling on day 1 is not allowed because you must buy before you sell.
```

Example 2:

```text
Input: prices = [7,6,4,3,1]
Output: 0
Explanation: In this case, no transactions are done and the max profit = 0.
```

Constraints:

- 1 <= prices.length <= 105
- 0 <= prices[i] <= 104

## Solution

I'm not really sure how this one is considered dynamic programming.

Anyway.

Keep track of the minimum price we've seen and the most profit we could have. Go through the array and check if we see a lower price. Update max profit as applicable.

```java
class Solution {
    public int maxProfit(int[] prices) {
        var minPrice = prices[0];
        var maxProfit = 0;

        for (var i : prices) {
            minPrice = Math.min(i, minPrice);
            maxProfit = Math.max(i - minPrice, maxProfit);
        }

        return maxProfit;
    }
}
```
