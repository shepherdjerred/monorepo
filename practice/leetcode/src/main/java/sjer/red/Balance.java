package sjer.red;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;

public class Balance {
  public static void main(String[] args) {
    System.out.println(getSuggestedPayments(List.of(new Tx("Jane", 4000, List.of("John", "Jane", "Alex", "Adam")),
        new Tx("Alex", 2000, List.of("Jane", "Alex")))));
  }

  public static List<Tx> getSuggestedPayments(List<Tx> txs) {
    // can we simplify a graph
    // cycles:
    // Isra -> Jerred (1000)
    var balanceMap = new HashMap<String, Integer>();
    for (var tx : txs) {
    // handle person that is owed
      balanceMap.compute(tx.name, (k, v) -> {
        if (v == null) {
          v = 0;
        }
        v -= tx.amount;
        return v;
      });
    // handle people that owe
      for (var payee : tx.payees) {
        balanceMap.compute(payee, (k, v) -> {
          if (v == null) {
            v = 0;
          }
          v += (tx.amount / tx.payees.size());
          return v;
        });
      }
    }
    // mapping of name -> idx
    String[] names = (String[]) balanceMap.keySet().stream().toArray();
    var bals = balanceMap.values().stream().mapToInt(i -> i).toArray();
    // sort
    // -2000, 0, 1000, 1000
    var steps = new ArrayList<Tx>();
    for (var i = 0; i < bals.length; i++) {
      var myBalance = bals[i];
      if (bals[i] >= 0) {
        continue;
      }

      // we need to settle this. find someone who can pay it
      var next = i + 1;
      while (myBalance < 0) {
        var theirBalance = bals[next];
        // settle the debt
        var sum = myBalance + theirBalance;
        if (sum == 0) {
          // both ok
          bals[i] = 0;
          bals[next] = 0;
          steps.add(new Tx(names[next], myBalance, List.of(names[i])));
        } else if (sum < 0) {
          // we need more
          bals[i] += bals[next];
          bals[next] = 0;
          steps.add(new Tx(names[next], bals[next], List.of(names[i])));
        } else {
          // we had more than enough
          bals[i] = 0;
          bals[next] = myBalance + theirBalance;
          steps.add(new Tx(names[next], myBalance + theirBalance, List.of(names[i])));
        }
        next += 1;
      }
    }
    // iterate over all balances
    // if it's zero, skip
    // if it's positive, skip
    // if it's negative, do something

    return steps;

  }

  record Tx(String name, int amount, List<String> payees) {
  }
}
