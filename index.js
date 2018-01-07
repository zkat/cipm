'use strict'

const BB = require('bluebird')

const binLink = require('bin-links')
const extract = require('./lib/extract.js')
const fs = require('graceful-fs')
const getPrefix = require('find-npm-prefix')
const lifecycle = require('npm-lifecycle')
const lockVerify = require('lock-verify')
const logi = require('npm-logical-tree')
const path = require('path')
const readPkgJson = BB.promisify(require('read-package-json'))
const rimraf = BB.promisify(require('rimraf'))

const readFileAsync = BB.promisify(fs.readFile)
const statAsync = BB.promisify(fs.stat)

class Installer {
  constructor (opts) {
    this.opts = opts
    this.config = opts.config

    // Stats
    this.startTime = Date.now()
    this.runTime = 0
    this.pkgCount = 0

    // Misc
    this.log = this.opts.log || require('./lib/silentlog.js')
    this.pkg = null
    this.tree = null
    this.failedDeps = new Set()
  }

  run () {
    const prefix = this.prefix
    return this.prepare()
    .then(() => this.extractTree(this.tree))
    .then(() => this.buildTree(this.tree))
    .then(() => this.garbageCollect(this.tree))
    .then(() => this.runScript('prepublish', this.pkg, prefix))
    .then(() => this.runScript('prepare', this.pkg, prefix))
    .then(() => this.teardown())
    .then(() => { this.runTime = Date.now() - this.startTime })
    .catch(err => { this.teardown(); throw err })
    .then(() => this)
  }

  prepare () {
    extract.startWorkers()

    return (
      this.config.get('prefix') && this.config.get('global')
      ? BB.resolve(this.config.get('prefix'))
      // There's some Special™ logic around the `--prefix` config when it
      // comes from a config file or env vs when it comes from the CLI
      : process.argv.some(arg => arg.match(/^\s*--prefix\s*/i))
      ? this.config.get('prefix')
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
    .then(() => statAsync(
      path.join(this.prefix, 'node_modules')
    ).catch(err => { if (err.code !== 'ENOENT') { throw err } }))
    .then(stat => {
      return BB.join(
        this.checkLock(),
        stat && rimraf(path.join(this.prefix, 'node_modules'))
      )
    }).then(() => {
      // This needs to happen -after- we've done checkLock()
      this.tree = logi(this.pkg, this.pkg._shrinkwrap)
    })
  }

  teardown () {
    return extract.stopWorkers()
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
    }).catch(err => {
      throw err
    })
  }

  extractTree (tree) {
    return tree.forEachAsync((dep, next) => {
      if (dep.dev && this.config.get('production')) { return }
      const depPath = dep.path(this.prefix)
      // Process children first, then extract this child
      return BB.join(
        !dep.isRoot &&
        extract.child(dep.name, dep, depPath, this.config, this.opts),
        next()
      ).then(() => { !dep.isRoot && this.pkgCount++ })
    }, {concurrency: 50, Promise: BB})
  }

  buildTree (tree) {
    return tree.forEachAsync((dep, next) => {
      if (dep.dev && this.config.get('production')) { return }
      const depPath = dep.path(this.prefix)
      return readPkgJson(path.join(depPath, 'package.json'))
      .then(pkg => {
        return this.runScript('preinstall', pkg, depPath)
        .then(next) // build children between preinstall and binLink
        // Don't link root bins
        .then(() => !dep.isRoot && binLink(pkg, depPath, false, {
          force: this.config.get('force'),
          ignoreScripts: this.config.get('ignore-scripts'),
          log: this.log,
          name: pkg.name,
          pkgId: pkg.name + '@' + pkg.version,
          prefix: this.prefix,
          prefixes: [this.prefix],
          umask: this.config.get('umask')
        }), e => {})
        .then(() => this.runScript('install', pkg, depPath))
        .then(() => this.runScript('postinstall', pkg, depPath))
        .then(() => this)
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
    if (
      !this.config.get('ignore-scripts') && pkg.scripts && pkg.scripts[stage]
    ) {
      // TODO(mikesherov): remove pkg._id when npm-lifecycle no longer relies on it
      pkg._id = pkg.name + '@' + pkg.version
      const opts = this.config.toLifecycle()
      return lifecycle(pkg, stage, pkgPath, opts)
    }
    return BB.resolve()
  }
}
module.exports = Installer
module.exports.CipmConfig = require('./lib/config/npm-config.js').CipmConfig

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
        !dep.isRoot && // never purge root! 🙈
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
