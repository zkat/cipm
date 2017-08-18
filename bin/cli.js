#!/usr/bin/env node

'use strict'

const yargs = require('yargs')
const main = require('../index.js')

main(parseArgs()).then((details) => {
  console.log(`added ${details.count} packages in ${
    details.time / 1000
  }s.`)
})

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
  .option('prefix', {
    type: 'string',
    describe: 'path to package.json'
  })
  .option('userconfig', {
    type: 'string',
    describe: 'path to npmrc'
  })
  .argv
}
