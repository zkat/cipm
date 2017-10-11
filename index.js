'use strict'

const BB = require('bluebird')

const binLink = require('bin-links')
const config = require('./lib/config.js')
const extract = require('./lib/extract.js')
const fs = require('graceful-fs')
const getPrefix = require('./lib/get-prefix.js')
const lifecycle = require('npm-lifecycle')
const lockVerify = require('lock-verify')
const logi = require('npm-logical-tree')
const npmlog = require('npmlog')
const path = require('path')
const readPkgJson = BB.promisify(require('read-package-json'))
const rimraf = BB.promisify(require('rimraf'))

const readFileAsync = BB.promisify(fs.readFile)

class Installer {
  constructor (opts) {
    this.opts = opts

    // Stats
    this.startTime = Date.now()
    this.runTime = 0
    this.pkgCount = 0

    // Misc
    this.log = npmlog
    this.pkg = null
  }

  run () {
    return this.prepare()
    .then(() => this.runScript('preinstall', this.pkg, this.prefix))
    .then(() => this.extractTree(this.logicalTree))
    .then(() => this.runScript('install', this.pkg, this.prefix))
    .then(() => this.runScript('postinstall', this.pkg, this.prefix))
    .then(() => this.runScript('prepublish', this.pkg, this.prefix))
    .then(() => this.runScript('prepare', this.pkg, this.prefix))
    .then(() => {
      extract.stopWorkers()
      this.runTime = Date.now() - this.startTime
      return this
    }, e => {
      extract.stopWorkers()
      throw e
    })
  }

  prepare () {
    extract.startWorkers()

    return (
      this.opts.prefix
      ? BB.resolve(this.opts.prefix)
      : getPrefix(process.cwd())
    )
    .then(prefix => {
      this.prefix = prefix
      return BB.join(
        readJson(prefix, 'package.json'),
        readJson(prefix, 'package-lock.json', true),
        readJson(prefix, 'npm-shrinkwrap.json', true),
        (pkg, lock, shrink) => {
          pkg._shrinkwrap = shrink || lock
          this.pkg = pkg
        }
      )
    })
    .then(() => config(this.prefix, process.argv, this.pkg))
    .then(conf => {
      this.config = conf
      return BB.join(
        this.checkLock(),
        rimraf(path.join(this.prefix, 'node_modules'))
      )
    }).then(() => {
      // This needs to happen -after- we've done checkLock()
      this.logicalTree = logi(this.pkg, this.pkg._shrinkwrap)
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

  extractTree (tree) {
    const deps = tree.dependencies.values()
    return BB.map(deps, child => {
      if (child.pending) { return hasCycle(child) || child.pending }
      if (child.dev && this.config.config.production) { return }
      const childPath = path.join(
        this.prefix,
        'node_modules',
        child.address.replace(/:/g, '/node_modules/')
      )
      child.pending = BB.resolve()
      .then(() => extract.child(child.name, child, childPath, this.config))
      .then(() => readPkgJson(path.join(childPath, 'package.json')))
      .then(pkg => {
        return this.runScript('preinstall', pkg, childPath)
        .then(() => this.extractTree(child))
        .then(() => binLink(pkg, childPath, false, {
          force: this.config.config.force,
          ignoreScripts: this.config.lifecycleOpts.ignoreScripts,
          log: this.log,
          name: pkg.name,
          pkgId: pkg.name + '@' + pkg.version,
          prefix: this.prefix,
          prefixes: [this.prefix],
          umask: this.config.config.umask
        }), e => {})
        .then(() => this.runScript('install', pkg, childPath))
        .then(() => this.runScript('postinstall', pkg, childPath))
        .then(() => {
          this.pkgCount++
          return this
        })
      })
      return child.pending
    }, { concurrency: 50 })
  }

  runScript (stage, pkg, pkgPath) {
    if (!this.config.lifecycleOpts.ignoreScripts && pkg.scripts && pkg.scripts[stage]) {
      // TODO(mikesherov): remove pkg._id when npm-lifecycle no longer relies on it
      pkg._id = pkg.name + '@' + pkg.version
      return lifecycle(pkg, stage, pkgPath, this.config.lifecycleOpts)
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

function hasCycle (child, seen) {
  seen = seen || new Set()
  if (seen.has(child.address)) {
    return true
  } else {
    seen.add(child.address)
    const deps = Array.from(child.dependencies.values())
    return deps.some(dep => hasCycle(dep, seen))
  }
}
