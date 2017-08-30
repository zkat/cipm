'use strict'

const BB = require('bluebird')

const config = require('./lib/config.js')
const extract = require('./lib/extract.js')
const fs = BB.promisifyAll(require('graceful-fs'))
const path = require('path')
const rimraf = BB.promisify(require('rimraf'))
const lifecycle = require('npm-lifecycle')

module.exports = main

function main (opts) {
  let prefix = path.resolve(opts.prefix)

  const startTime = Date.now()
  const nodeModulesPath = path.join(prefix, 'node_modules')
  let pkgCount = 0

  extract.startWorkers()

  return BB.join(
    readJson(prefix, 'package.json'),
    readJson(prefix, 'package-lock.json', true),
    readJson(prefix, 'npm-shrinkwrap.json', true),
    (pkg, lock, shrink) => {
      pkg._shrinkwrap = lock || shrink
      return pkg
    }
  ).tap(pkg => {
    if (!pkg._shrinkwrap || !pkg._shrinkwrap.lockfileVersion) {
      throw new Error(`cipm can only install packages with an existing package-lock.json or npm-shrinkwrap.json with lockfileVersion >= 1. Run an install with npm@5 or later to generate it, then try again.`)
    }

    return rimraf(nodeModulesPath)
  }).tap(pkg => {
    return runScript('preinstall', pkg, prefix)
  }).tap(pkg => {
    return extractDeps(
      nodeModulesPath,
      pkg._shrinkwrap.dependencies
    )
  }).tap(pkg => {
    return runScript('install', pkg, prefix)
  }).tap(pkg => {
    return runScript('postinstall', pkg, prefix)
  }).then(pkg => {
    extract.stopWorkers()
    return {
      count: pkgCount,
      time: Date.now() - startTime
    }
  })

  function runScript (stage, pkg, pkgPath) {
    if (pkg.scripts && pkg.scripts[stage]) {
      // TODO(mikesherov): remove pkg._id when npm-lifecycle no longer relies on it
      pkg._id = pkg.name + '@' + pkg.version
      return config(prefix).then(config => lifecycle(pkg, stage, pkgPath, config))
    }
    return BB.resolve()
  }

  function extractDeps (modPath, deps) {
    return BB.map(Object.keys(deps || {}), name => {
      const child = deps[name]
      const childPath = path.join(modPath, name)
      return extract.child(name, child, childPath)
      .then(() => {
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

  function readJson (jsonPath, name, ignoreMissing) {
    return fs.readFileAsync(path.join(jsonPath, name), 'utf8')
    .then(str => JSON.parse(str))
    .catch({code: 'ENOENT'}, err => {
      if (!ignoreMissing) {
        throw err
      }
    })
  }
}
