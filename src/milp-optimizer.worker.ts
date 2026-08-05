import loadHighs from "highs";
import highsWasmUrl from "highs/runtime?url";
import {
  optimizeArtifactCombinationsMilp,
  type MilpProgress,
} from "./milp-optimizer";
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

self.onmessage = async (event: MessageEvent<SearchRequest>) => {
  try {
    const solver = await loadHighs({ locateFile: () => highsWasmUrl });
    const result = await optimizeArtifactCombinationsMilp(
      solver,
      event.data.container,
      event.data.candidates,
      event.data.objectives,
      event.data.settings,
      (progress: MilpProgress) => self.postMessage({ type: "progress", progress }),
    );
    self.postMessage({ type: "result", result });
  } catch (error) {
    self.postMessage({
      type: "error",
      error: error instanceof Error ? error.message : "MILP optimizer failed.",
    });
  }
};
