import type { Highs } from "highs";
import type { MilpSolution, MilpSolver } from "./milp-optimizer";

const MODEL_STATUS_NAMES: Record<number, string> = {
  0: "Not Set",
  1: "Load error",
  2: "Model error",
  3: "Presolve error",
  4: "Solve error",
  5: "Postsolve error",
  6: "Empty",
  7: "Optimal",
  8: "Infeasible",
  9: "Primal infeasible or unbounded",
  10: "Unbounded",
  11: "Bound on objective reached",
  12: "Target for objective reached",
  13: "Time limit reached",
  14: "Iteration limit reached",
  15: "Unknown",
  16: "Solution limit reached",
  17: "Interrupted",
};

export function createPersistentMilpSolver(highs: Highs): MilpSolver {
  return {
    solve(problem, options): MilpSolution {
      const model = highs.createModel({ format: "lp", data: problem });
      try {
        model.options.set(options ?? {});
        const run = model.run();
        const Status = MODEL_STATUS_NAMES[run.modelStatus] ?? `Status ${run.modelStatus}`;
        const HasFeasibleSolution = model.info.get("primal_solution_status")
          === highs.constants.solutionStatus.feasible;
        if (!HasFeasibleSolution) return { Status, Columns: {}, HasFeasibleSolution };

        const rawSolution = model.getSolution();
        const Columns: Record<string, { Primal: number }> = {};
        rawSolution.colValue.forEach((Primal, index) => {
          Columns[model.getColName(index)] = { Primal };
        });
        const rawGap = model.info.get("mip_gap");
        const rawBound = model.info.get("mip_dual_bound");
        return {
          Status,
          Columns,
          ObjectiveValue: model.getObjectiveValue(),
          Bound: typeof rawBound === "number" && Number.isFinite(rawBound) ? rawBound : undefined,
          Gap: typeof rawGap === "number" && Number.isFinite(rawGap) ? rawGap : undefined,
          HasFeasibleSolution,
        };
      } finally {
        model.dispose();
      }
    },
  };
}
