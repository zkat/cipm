#!/usr/bin/env node

'use strict'

const config = require('../lib/config/npm-config.js')
const yargs = require('yargs')
const Installer = require('../index.js')

module.exports = cliMain

if (require.main === module) {
  cliMain()
}

function cliMain () {
  parseArgs()
  return config.fromNpm(process.argv)
  .then(c => new Installer({
    config: c,
    log: require('npmlog')
  }).run())
  .then(
    details => console.error(`added ${details.pkgCount} packages in ${
      details.runTime / 1000
    }s`),
    err => console.error(`cipm failed:\n${err.message}\n${err.stack}`)
  )
}

function parseArgs () {
  return yargs
  .usage('Install dependencies from an existing package-lock.json')
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
  .option('prefix', {
    type: 'string',
    describe: 'path to package.json'
  })
  .option('userconfig', {
    type: 'string',
    describe: 'path to npmrc'
  })
  .help()
  .alias('h', 'help')
  .argv
}
