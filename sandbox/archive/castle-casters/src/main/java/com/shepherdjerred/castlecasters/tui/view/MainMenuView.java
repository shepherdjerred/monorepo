package com.shepherdjerred.castlecasters.tui.view;

import lombok.AllArgsConstructor;
import lombok.extern.log4j.Log4j2;

import java.util.Optional;
import java.util.Scanner;

@Log4j2
@AllArgsConstructor
public class MainMenuView implements View {

  private final Scanner scanner;

  @Override
  public Optional<View> display() {
    var shouldContinue = true;
    while (shouldContinue) {
      System.out.println("Main Menu");
      System.out.println("1. Play vs AI");
      System.out.println("2. Run Genetic AI");
      System.out.println("3. Exit");

      var in = scanner.next();
      try {
        var intValue = Integer.parseInt(in);

        if (intValue == 1) {
          return Optional.of(new VersusAiSetupView(scanner));
        } else if (intValue == 2) {
          return Optional.of(new GeneticAiView(scanner));
        } else if (intValue == 3) {
          shouldContinue = false;
        } else {
          System.out.println("Invalid input. Try again.");
        }
      } catch (Exception e) {
        log.error("Error parsing int", e);
      }
    }

    return Optional.empty();
  }
}
