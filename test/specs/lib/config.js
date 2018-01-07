'use strict'

const test = require('tap').test
const requireInject = require('require-inject')
const childProcessFactory = require('../../lib/childProcessFactory.js')

let child
const config = requireInject('../../../lib/config/npm-config.js', {
  child_process: {
    spawn: () => child
  }
}).fromNpm

function cleanup () {
  child = childProcessFactory()
}

test('config: errors if npm is not found', t => {
  cleanup()

  config().catch(err => {
    t.equal(err.message, '`npm` command not found. Please ensure you have npm@5.4.0 or later installed.')
    t.end()
  })

  child.emit('close', 127)
})

test('config: errors if npm config ls --json cant output json', t => {
  cleanup()

  config().catch(err => {
    t.equal(err.message, '`npm config ls --json` failed to output json. Please ensure you have npm@5.4.0 or later installed.')
    t.end()
  })

  child.stdout.emit('data', 'this is definitely not json')
  child.emit('close', 0)
})

test('config: errors if npm errors for any reason', t => {
  cleanup()
  // in error situations, stdout may not exist
  delete child.stdout

  const errorMessage = 'failed to reticulate splines'

  config().catch(err => {
    t.equal(err, errorMessage)
    t.end()
  })

  child.emit('error', errorMessage)
})

test('config: parses configs from npm', t => {
  cleanup()

  const expectedConfig = { a: 1, b: 2 }

  config().then(config => {
    const objConf = {}
    for (const k of config.keys()) {
      objConf[k] = config.get(k)
    }
    t.deepEqual(objConf, expectedConfig, 'configs match')
    t.end()
  })

  child.stdout.emit('data', JSON.stringify(expectedConfig))
  child.emit('close', 0)
})

test('config: cleanup', t => {
  cleanup()
  t.end()
})
