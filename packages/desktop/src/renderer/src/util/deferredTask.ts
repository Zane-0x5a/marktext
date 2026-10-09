// A task that runs after the current frame, at most once per `intervalMs`,
// however often it is requested in between.
//
// Requests made inside a `requestAnimationFrame` callback run in a later task,
// so the frame being produced is painted first. `flush()` runs a pending task
// immediately, for readers that need its result now.
export interface DeferredTask {
  request(): void
  flush(): void
  cancel(): void
}

export const createDeferredTask = (task: () => void, intervalMs: number): DeferredTask => {
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastRun = -Infinity

  const run = () => {
    timer = null
    lastRun = Date.now()
    task()
  }

  return {
    request() {
      if (timer !== null) return
      timer = setTimeout(run, Math.max(0, lastRun + intervalMs - Date.now()))
    },
    flush() {
      if (timer === null) return
      clearTimeout(timer)
      run()
    },
    cancel() {
      if (timer === null) return
      clearTimeout(timer)
      timer = null
    }
  }
}
