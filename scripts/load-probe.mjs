// Loaded into the server process by scripts/load-test.ts (node --import): once a second it tells the test how much
// processor time and memory the server has used, and the longest it was frozen. It does nothing unless the server was
// started by the load test (which opens a message channel to it).
if (process.send) {
  let last = Date.now()
  let lag = 0
  setInterval(() => {
    const now = Date.now()
    lag = Math.max(lag, now - last - 100)
    last = now
  }, 100).unref()
  setInterval(() => {
    const c = process.cpuUsage()
    const m = process.memoryUsage()
    process.send({ lt: 1, t: Date.now(), cpuMs: (c.user + c.system) / 1000, rss: m.rss, heap: m.heapUsed, lagMs: lag })
    lag = 0
  }, 1000).unref()
}
