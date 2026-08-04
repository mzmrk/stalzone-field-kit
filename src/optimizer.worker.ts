import { optimizeArtifactCombinations } from "./optimizer";
import type {
  OptimizerCandidate,
  OptimizerContainer,
  OptimizerObjective,
  OptimizerSettings,
} from "./optimizer";

type SearchRequest = {
  container: OptimizerContainer;
  candidates: OptimizerCandidate[];
  objectives: OptimizerObjective[];
  settings: OptimizerSettings;
};

self.onmessage = (event: MessageEvent<SearchRequest>) => {
  try {
    const result = optimizeArtifactCombinations(
      event.data.container,
      event.data.candidates,
      event.data.objectives,
      event.data.settings,
      (progress) => self.postMessage({ type: "progress", progress }),
    );
    self.postMessage({ type: "result", result });
  } catch (error) {
    self.postMessage({
      type: "error",
      error: error instanceof Error ? error.message : "Optimizer search failed.",
    });
  }
};
