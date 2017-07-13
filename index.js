#!/usr/bin/env node

'use strict'

const BB = require('bluebird')

const extractionWorker = require('./worker.js')
const fs = BB.promisifyAll(require('graceful-fs'))
const npa = require('npm-package-arg')
const path = require('path')
const rimraf = BB.promisify(require('rimraf'))
const workerFarm = require('worker-farm')
const yargs = require('yargs')

const WORKER_PATH = require.resolve('./worker.js')
let workers

main(parseArgs())

let pkgCount = 0

function parseArgs () {
  return yargs
  .option('loglevel', {
    type: 'string',
    describe: 'log level for npmlog',
    default: 'notice'
  })
  .option('offline', {
    type: 'boolean',
    describe: 'force cipm to run offline, or error'
  })
  .option('ignore-scripts', {
    type: 'boolean',
    describe: 'skip running lifecycle scripts'
  })
  .option('userconfig', {
    type: 'string',
    describe: 'path to npmrc'
  })
  .argv
}

function main () {
  const startTime = Date.now()
  workers = workerFarm({
    maxConcurrentCallsPerWorker: 30,
    maxRetries: 1
  }, WORKER_PATH)
  return BB.join(
    readJson('.', 'package.json'),
    readJson('.', 'package-lock.json', true),
    readJson('.', 'npm-shrinkwrap.json', true),
    (pkg, lock, shrink) => {
      pkg._shrinkwrap = lock || shrink
      return pkg
    }
  ).tap(pkg => {
    if (!pkg._shrinkwrap || !pkg._shrinkwrap.lockfileVersion) {
      throw new Error(`cipm can only install packages with an existing package-lock.json or npm-shrinkwrap.json with lockfileVersion >= 1. Run an install with npm@5 or later to generate it, then try again.`)
    }

    return rimraf('./node_modules')
  }).tap(pkg => {
    return runScript('preinstall', pkg, '.')
  }).tap(pkg => {
    return extractDeps(
      `./node_modules`,
      pkg._shrinkwrap.dependencies
    )
  }).tap(pkg => {
    return runScript('install', pkg, '.')
  }).tap(pkg => {
    return runScript('postinstall', pkg, '.')
  }).then(pkg => {
    workerFarm.end(workers)
    console.log(`added ${pkgCount} packages in ${
      (Date.now() - startTime) / 1000
    }s.`)
  })
}

function runScript (script, pkg, pkgPath) {
  if (pkg.scripts && pkg.scripts[script]) {
    console.log('executing', script, 'on', pkgPath)
  }
  return BB.resolve()
}

function extractDeps (modPath, deps) {
  return BB.map(Object.keys(deps || {}), name => {
    const child = deps[name]
    const childPath = path.join(modPath, name)
    return (
      child.bundled
      ? BB.resolve()
      : extractChild(name, child, childPath)
    ).then(() => {
      return readJson(childPath, 'package.json')
    }).tap(pkg => {
      return runScript('preinstall', pkg, childPath)
    }).then(pkg => {
      return extractDeps(path.join(childPath, 'node_modules'), child.dependencies)
      .then(dependencies => {
        return {
          name,
          package: pkg,
          child,
          childPath,
          dependencies: dependencies.reduce((acc, dep) => {
            acc[dep.name] = dep
            return acc
          }, {})
        }
      })
    }).tap(full => {
      pkgCount++
      return runScript('install', full.package, childPath)
    }).tap(full => {
      return runScript('postinstall', full.package, childPath)
    })
  }, {concurrency: 50})
}

function extractChild (name, child, childPath) {
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
      launcher = workers
      try {
        msg = JSON.stringify(msg)
      } catch (e) {
        return cb(e)
      }
    }
    launcher(msg, cb)
  })
}

function readJson (jsonPath, name, ignoreMissing) {
  return fs.readFileAsync(path.join(jsonPath, name), 'utf8')
  .then(str => JSON.parse(str))
  .catch({code: 'ENOENT'}, err => {
    if (!ignoreMissing) {
      throw err
    }
  })
}
