'use strict'

const BB = require('bluebird')

const config = require('./lib/config.js')
const extract = require('./lib/extract.js')
const fs = require('graceful-fs')
const getPrefix = require('./lib/get-prefix.js')
const lifecycle = require('npm-lifecycle')
const lockVerify = require('lock-verify')
const path = require('path')
const rimraf = BB.promisify(require('rimraf'))

const readFileAsync = BB.promisify(fs.readFile)

class Installer {
  constructor (opts) {
    // Config
    this.opts = opts

    // Stats
    this.startTime = Date.now()
    this.runTime = null
    this.pkgCount = 0

    // Misc
    this.pkg = null
    this.scriptQ = []
  }

  run () {
    extract.startWorkers()

    return (
      this.opts.prefix
      ? BB.resolve(this.opts.prefix)
      : getPrefix(process.cwd())
    ).then(prefix => {
      this.prefix = prefix
      return BB.join(
        readJson(prefix, 'package.json'),
        readJson(prefix, 'package-lock.json', true),
        readJson(prefix, 'npm-shrinkwrap.json', true),
        (pkg, lock, shrink) => {
          pkg._shrinkwrap = lock || shrink
          this.pkg = pkg
        }
      )
    }).then(() => {
      return BB.join(
        this.checkLock(),
        rimraf(path.join(this.prefix, 'node_modules'))
      )
    }).then(() => {
      return this.runScript('preinstall', this.pkg, this.prefix)
    }).then(() => {
      return this.extractDeps(
        path.join(this.prefix, 'node_modules'),
        this.pkg._shrinkwrap.dependencies
      )
    }).then(() => {
      return this.runScript('install', this.pkg, this.prefix)
    }).then(() => {
      return this.runScript('postinstall', this.pkg, this.prefix)
    }).then(() => {
      extract.stopWorkers()
      this.runTime = Date.now() - this.startTime
      return this
    })
  }

  checkLock () {
    const pkg = this.pkg
    const prefix = this.prefix
    if (!pkg._shrinkwrap || !pkg._shrinkwrap.lockfileVersion) {
      return BB.reject(
        new Error(`cipm can only install packages with an existing package-lock.json or npm-shrinkwrap.json with lockfileVersion >= 1. Run an install with npm@5 or later to generate it, then try again.`)
      )
    }
    return lockVerify(prefix).then(result => {
      if (result.status) {
        result.warnings.forEach(w => console.error('Warning:', w))
      } else {
        throw new Error(
          'cipm can only install packages when your package.json and package-lock.json or ' +
          'npm-shrinkwrap.json are in sync. Please update your lock file with `npm install` ' +
          'before continuing.\n\n' +
          result.warnings.map(w => 'Warning: ' + w).join('\n') + '\n' +
          result.errors.join('\n') + '\n'
        )
      }
    })
  }

  extractDeps (modPath, deps) {
    return BB.map(Object.keys(deps || {}), name => {
      const child = deps[name]
      const childPath = path.join(modPath, name)
      return extract.child(name, child, childPath).then(() => {
        return readJson(childPath, 'package.json')
      }).tap(pkg => {
        return this.runScript('preinstall', pkg, childPath)
      }).then(pkg => {
        return this.extractDeps(path.join(childPath, 'node_modules'), child.dependencies)
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
        this.pkgCount++
        return this.runScript('install', full.package, childPath)
      }).tap(full => {
        return this.runScript('postinstall', full.package, childPath)
      })
    }, {concurrency: 50})
  }

  runScript (stage, pkg, pkgPath) {
    if (!this.opts.ignoreScripts && pkg.scripts && pkg.scripts[stage]) {
      // TODO(mikesherov): remove pkg._id when npm-lifecycle no longer relies on it
      pkg._id = pkg.name + '@' + pkg.version
      return config(this.prefix).then(config => {
        return lifecycle(pkg, stage, pkgPath, config)
      })
    }
    return BB.resolve()
  }
}
module.exports = Installer
module.exports._readJson = readJson

function readJson (jsonPath, name, ignoreMissing) {
  return readFileAsync(path.join(jsonPath, name), 'utf8')
  .then(str => JSON.parse(stripBOM(str)))
  .catch({code: 'ENOENT'}, err => {
    if (!ignoreMissing) {
      throw err
    }
  })
}

function stripBOM (str) {
  return str.replace(/^\uFEFF/, '')
}
