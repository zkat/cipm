'use strict'

const BB = require('bluebird')
const test = require('tap').test
const requireInject = require('require-inject')

test('cli: invokes main with parsed options', t => {
  t.plan(2)
  class FakeInstaller {
    constructor (opts) {
      this.opts = opts
    }
    run () {
      t.comment('opts:', this.opts)
      t.is(this.opts.ignoreScripts, false, 'ignoreScripts defaults to false')
      t.is(this.opts.offline, false, 'offline defaults to false')
      return BB.resolve({count: 0, time: 0})
    }
  }
  let cli = requireInject('../../../bin/cli.js', {
    '../../../index.js': FakeInstaller
  })
  return cli()
})
