import {
  evaluatePredictions,
  loadPredictionEvaluationRows,
} from "#src/betting/prediction-evaluation.ts";

const observations = await loadPredictionEvaluationRows();
console.info(JSON.stringify(evaluatePredictions(observations), null, 2));
