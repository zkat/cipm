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
    this.tree = null
    this.failedDeps = new Set()
  }

  run () {
    return this.prepare()
    .then(() => this.extractTree(this.tree))
    .then(() => this.buildTree(this.tree))
    .then(() => this.garbageCollect(this.tree))
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
      this.tree = logi(this.pkg, this.pkg._shrinkwrap)
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
    return tree.forEachAsync((dep, next) => {
      if (dep.dev && this.config.config.production) { return }
      const depPath = dep.path(this.prefix)
      // Process children first, then extract this child
      return BB.join(
        !dep.isRoot && extract.child(dep.name, dep, depPath, this.config),
        next()
      ).then(() => { !dep.isRoot && this.pkgCount++ })
    }, {concurrency: 50, Promise: BB})
  }

  buildTree (tree) {
    return tree.forEachAsync((dep, next) => {
      if (dep.dev && this.config.config.production) { return }
      const depPath = dep.path(this.prefix)
      return readPkgJson(path.join(depPath, 'package.json'))
      .then(pkg => {
        return this.runScript('preinstall', pkg, depPath)
        .then(next) // build children between preinstall and binLink
        .then(() => dep !== this.tree && // Don't link root bins
        binLink(pkg, depPath, false, {
          force: this.config.config.force,
          ignoreScripts: this.config.lifecycleOpts.ignoreScripts,
          log: this.log,
          name: pkg.name,
          pkgId: pkg.name + '@' + pkg.version,
          prefix: this.prefix,
          prefixes: [this.prefix],
          umask: this.config.config.umask
        }), e => {})
        .then(() => this.runScript('install', pkg, depPath))
        .then(() => this.runScript('postinstall', pkg, depPath))
        .then(() => {
          return this
        })
        .catch(e => {
          if (dep.optional) {
            this.failedDeps.add(dep)
          } else {
            throw e
          }
        })
      })
    }, {concurrency: 50, Promise: BB})
  }

  // A cute little mark-and-sweep collector!
  garbageCollect (tree) {
    if (!this.failedDeps.size) { return }
    return sweep(
      tree,
      this.prefix,
      mark(tree, this.failedDeps)
    )
    .then(purged => {
      this.purgedDeps = purged
      this.pkgCount -= purged.size
    })
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

function mark (tree, failed) {
  const liveDeps = new Set()
  tree.forEach((dep, next) => {
    if (!failed.has(dep)) {
      liveDeps.add(dep)
      next()
    }
  })
  return liveDeps
}

function sweep (tree, prefix, liveDeps) {
  const purged = new Set()
  return tree.forEachAsync((dep, next) => {
    return next().then(() => {
      if (
        dep !== tree && // never purge root! 🙈
        !liveDeps.has(dep) &&
        !purged.has(dep)
      ) {
        purged.add(dep)
        return rimraf(dep.path(prefix))
      }
    })
  }, {concurrency: 50, Promise: BB}).then(() => purged)
}

function stripBOM (str) {
  return str.replace(/^\uFEFF/, '')
}

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
