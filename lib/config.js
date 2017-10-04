'use strict'

const BB = require('bluebird')
const log = require('npmlog')
const cipmPkg = require('../package.json')
const spawn = require('child_process').spawn

module.exports = getConfig
module.exports._resetConfig = _resetConfig

let _config

// Right now, we're leaning on npm itself to give us a config and do all the
// usual npm config logic. In the future, we'll have a standalone package that
// does compatible config loading -- but this version just runs a child
// process.
function readConfig (argv) {
  return new BB((resolve, reject) => {
    const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm'
    const child = spawn(npmBin, [
      'config', 'ls', '--json', '-l'
      // We add argv here to get npm to parse those options for us :D
    ].concat(argv || []), {
      env: process.env,
      cwd: process.cwd(),
      stdio: [0, 'pipe', 2]
    })

    let stdout = ''
    if (child.stdout) {
      child.stdout.on('data', (chunk) => {
        stdout += chunk
      })
    }

    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 127) {
        reject(new Error('`npm` command not found. Please ensure you have npm@5.4.0 or later installed.'))
      } else {
        try {
          resolve(JSON.parse(stdout))
        } catch (e) {
          reject(new Error('`npm config ls --json` failed to output json. Please ensure you have npm@5.4.0 or later installed.'))
        }
      }
    })
  })
}

/**
 * used solely for testing
 */
function _resetConfig () {
  _config = undefined
}

function getConfig (dir, argv, rootPkg) {
  if (_config) return BB.resolve(_config)
  return readConfig(argv).then(config => {
    log.level = config['loglevel']
    config['user-agent'] = config['user-agent'] || `${cipmPkg.name}@${cipmPkg.version} ${process.release.name}@${process.version.replace(/^v/, '')} ${process.platform} ${process.arch}`
    _config = {
      prefix: dir,
      log,
      rootPkg,
      config,
      // These are opts for `npm-lifecycle`
      lifecycleOpts: {
        config,
        scriptShell: config['script-shell'],
        force: config.force,
        user: config.user,
        group: config.group,
        ignoreScripts: config['ignore-scripts'],
        ignorePrepublish: config['ignore-prepublish'],
        scriptsPrependNodePath: config['scripts-prepend-node-path'],
        unsafePerm: config['unsafe-perm'],
        log,
        dir,
        failOk: false,
        production: config.production
      }
    }
    return _config
  })
}
