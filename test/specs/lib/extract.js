'use strict'

const test = require('tap').test
const requireInject = require('require-inject')

const extract = requireInject('../../../lib/extract.js', {
  '../../../lib/worker.js': (msg, cb) => { cb(null, msg) },
  'npm-package-arg': {
    resolve: () => ({ registry: false, type: 'not-remote' })
  }
})

test('extract.child() only overwrites dirPacker when opts.dirPacker is defined', t => {
  const name = 'name'
  const child = { version: '0.0.0', integrity: 'integrity', resolved: 'resolved' }
  const childPath = './path'
  const config = {
    toPacote (moreOpts) {
      return moreOpts
    }
  }

  const opts = { log: { level: 'level' } }
  const a = extract.child(name, child, childPath, config, opts)

  a.then(b => {
    t.ok(!('dirPacker' in b[2]), 'An undefined dirPacker overrode the pacote childOpts')
    t.end()
  })
})
