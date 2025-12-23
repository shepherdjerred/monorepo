import type { InitialOptionsTsJest } from "ts-jest";

const options: InitialOptionsTsJest = {
  preset: "ts-jest",
  testEnvironment: "node",
  testPathIgnorePatterns: ["build/"],
  testTimeout: 30000,
};

export default options;
