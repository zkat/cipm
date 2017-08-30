'use strict'

const BB = require('bluebird')
const log = require('npmlog')
const spawn = require('child_process').spawn

module.exports = getConfig
module.exports._resetConfig = _resetConfig

let _config

function readConfig () {
  return new BB((resolve, reject) => {
    const child = spawn('npm', ['config', 'ls', '--json'], {
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

function getConfig (dir) {
  if (_config) return BB.resolve(_config)
  return readConfig().then(config => {
    _config = {
      config,
      dir,
      failOk: false,
      force: config.force,
      group: config.group,
      ignorePrepublish: config['ignore-prepublish'],
      ignoreScripts: config['ignore-scripts'],
      log,
      production: config.production,
      scriptShell: config['script-shell'],
      scriptsPrependNodePath: config['scripts-prepend-node-path'],
      unsafePerm: config['unsafe-perm'],
      user: config['user']
    }

    return _config
  })
}
