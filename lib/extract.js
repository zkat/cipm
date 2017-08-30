'use strict'

const BB = require('bluebird')
const npa = require('npm-package-arg')
const path = require('path')
const workerFarm = require('worker-farm')

const extractionWorker = require('./worker.js')
const WORKER_PATH = require.resolve('./worker.js')

module.exports = {
  startWorkers () {
    this._workers = workerFarm({
      maxConcurrentCallsPerWorker: 30,
      maxRetries: 1
    }, WORKER_PATH)
  },

  stopWorkers () {
    workerFarm.end(this._workers)
  },

  child (name, child, childPath) {
    if (child.bundled) return BB.resolve()

    const spec = npa.resolve(name, child.resolved || child.version)
    const opts = {
      cache: path.resolve(process.env.HOME, '.npm/_cacache'),
      integrity: child.integrity
    }
    const args = [spec, childPath, opts]
    return BB.fromNode((cb) => {
      let launcher = extractionWorker
      let msg = args
      const spec = typeof args[0] === 'string' ? npa(args[0]) : args[0]
      if (spec.registry || spec.type === 'remote') {
        // workers will run things in parallel!
        launcher = this._workers
        try {
          msg = JSON.stringify(msg)
        } catch (e) {
          return cb(e)
        }
      }
      launcher(msg, cb)
    })
  }
}
