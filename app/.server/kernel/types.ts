import type { Actor, PendingSession } from "../auth/types";
import type { WorkerEnv } from "../config/env";
import type { ServerContext } from "../context";

export interface KernelVariables {
  server: ServerContext;
  actor: Actor | null;
  pending: PendingSession | null;
  nonce: string;
  /** True when the response is the planned maintenance 503 (logged at info — CP-2.1 · O-1). */
  maintenance: boolean;
}

export type KernelEnv = { Bindings: WorkerEnv; Variables: KernelVariables };
