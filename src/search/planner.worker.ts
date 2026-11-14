/// <reference lib="webworker" />
/**
 * Runs the lookahead planner off the main thread. One request at a time; the
 * app terminates and recreates the worker to cancel a search that is outdated.
 * Every plan posted back has been replayed through the real engine (see verify.ts).
 */
import { type Plan, type PlanProgress, type PlanRequest, searchPlans } from '../engine/planner'

export type WorkerIn = { id: number; req: PlanRequest }
export type WorkerOut =
  | ({ id: number; kind: 'progress' } & PlanProgress)
  | { id: number; kind: 'done'; plans: Plan[]; ms: number; discarded: number }

const ctx = self as unknown as DedicatedWorkerGlobalScope

ctx.onmessage = (e: MessageEvent<WorkerIn>) => {
  const { id, req } = e.data
  const t0 = performance.now()
  let discarded = 0
  const plans = searchPlans(req, (p) => {
    discarded = p.discarded
    ctx.postMessage({ id, kind: 'progress', ...p } satisfies WorkerOut)
  })
  ctx.postMessage({ id, kind: 'done', plans, ms: performance.now() - t0, discarded } satisfies WorkerOut)
}
