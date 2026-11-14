/// <reference lib="webworker" />
/**
 * Runs the lookahead planner off the main thread. One request at a time; the
 * app terminates and recreates the worker to cancel a search that is outdated.
 */
import { type Plan, type PlanProgress, type PlanRequest, searchPlans } from '../engine/planner'

export type WorkerIn = { id: number; req: PlanRequest }
export type WorkerOut =
  | ({ id: number; kind: 'progress' } & PlanProgress)
  | { id: number; kind: 'done'; plans: Plan[]; ms: number }

const ctx = self as unknown as DedicatedWorkerGlobalScope

ctx.onmessage = (e: MessageEvent<WorkerIn>) => {
  const { id, req } = e.data
  const t0 = performance.now()
  const plans = searchPlans(req, (p) => ctx.postMessage({ id, kind: 'progress', ...p } satisfies WorkerOut))
  ctx.postMessage({ id, kind: 'done', plans, ms: performance.now() - t0 } satisfies WorkerOut)
}
