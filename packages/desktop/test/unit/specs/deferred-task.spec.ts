import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createDeferredTask } from '@/util/deferredTask'

describe('createDeferredTask', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('runs in a later task, not synchronously', () => {
    const task = vi.fn()
    const deferred = createDeferredTask(task, 150)
    deferred.request()
    expect(task).not.toHaveBeenCalled()
    vi.advanceTimersByTime(0)
    expect(task).toHaveBeenCalledTimes(1)
  })

  it('coalesces requests made before it runs', () => {
    const task = vi.fn()
    const deferred = createDeferredTask(task, 150)
    deferred.request()
    deferred.request()
    deferred.request()
    vi.runAllTimers()
    expect(task).toHaveBeenCalledTimes(1)
  })

  it('runs at most once per interval while requests keep coming', () => {
    const task = vi.fn()
    const deferred = createDeferredTask(task, 150)
    // A keystroke every 30 ms for 600 ms.
    for (let t = 0; t <= 600; t += 30) {
      deferred.request()
      vi.advanceTimersByTime(30)
    }
    vi.runAllTimers()
    // The first run is immediate, then one per 150 ms window, plus the trailing run.
    expect(task.mock.calls.length).toBeGreaterThanOrEqual(4)
    expect(task.mock.calls.length).toBeLessThanOrEqual(6)
  })

  it('always runs once more after the last request (trailing run)', () => {
    const task = vi.fn()
    const deferred = createDeferredTask(task, 150)
    deferred.request()
    vi.advanceTimersByTime(0)
    expect(task).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(10)
    deferred.request()
    vi.advanceTimersByTime(100)
    expect(task).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(40)
    expect(task).toHaveBeenCalledTimes(2)
  })

  it('runs immediately after an idle period longer than the interval', () => {
    const task = vi.fn()
    const deferred = createDeferredTask(task, 150)
    deferred.request()
    vi.advanceTimersByTime(0)
    vi.advanceTimersByTime(1000)
    deferred.request()
    vi.advanceTimersByTime(0)
    expect(task).toHaveBeenCalledTimes(2)
  })

  it('flush() runs a pending task now and does not run it again later', () => {
    const task = vi.fn()
    const deferred = createDeferredTask(task, 150)
    deferred.request()
    deferred.flush()
    expect(task).toHaveBeenCalledTimes(1)
    vi.runAllTimers()
    expect(task).toHaveBeenCalledTimes(1)
  })

  it('flush() does nothing when no request is pending', () => {
    const task = vi.fn()
    const deferred = createDeferredTask(task, 150)
    deferred.flush()
    expect(task).not.toHaveBeenCalled()
    deferred.request()
    vi.runAllTimers()
    deferred.flush()
    expect(task).toHaveBeenCalledTimes(1)
  })

  it('cancel() drops a pending task', () => {
    const task = vi.fn()
    const deferred = createDeferredTask(task, 150)
    deferred.request()
    deferred.cancel()
    vi.runAllTimers()
    expect(task).not.toHaveBeenCalled()
  })
})
