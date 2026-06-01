// Tiny promise-based RPC over a Worker. Each call gets a request id; the worker
// echoes it back so concurrent jobs resolve independently. Reusable for any
// worker that follows the { id, type, payload } → { id, result | error }
// protocol — add a job by registering it worker-side, no change here.

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void }

export type WorkerClient = {
  run<T>(type: string, payload?: unknown): Promise<T>
  dispose: () => void
}

export function createWorkerClient(worker: Worker): WorkerClient {
  const pending = new Map<number, Pending>()
  let nextId = 0

  worker.onmessage = (e: MessageEvent) => {
    const { id, result, error } = e.data as {
      id: number
      result?: unknown
      error?: string
    }
    const p = pending.get(id)
    if (!p) return
    pending.delete(id)
    if (error) p.reject(new Error(error))
    else p.resolve(result)
  }

  worker.onerror = (e) => {
    // A worker-level failure (e.g. a thrown import) rejects everything in flight
    // so awaiters don't hang forever.
    const err = new Error(e.message || 'worker error')
    for (const p of pending.values()) p.reject(err)
    pending.clear()
  }

  return {
    run<T>(type: string, payload?: unknown): Promise<T> {
      const id = nextId++
      return new Promise<T>((resolve, reject) => {
        pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
        worker.postMessage({ id, type, payload })
      })
    },
    dispose() {
      worker.terminate()
      const err = new Error('worker disposed')
      for (const p of pending.values()) p.reject(err)
      pending.clear()
    },
  }
}
