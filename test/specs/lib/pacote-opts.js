'use strict'

const test = require('tap').test

const pacoteOpts = require('../../../lib/pacote-opts.js')

test('returns a config object usable by pacote', t => {
  const opts = pacoteOpts({
    config: {
      ca: 'idk',
      cache: '/foo',
      'maxsockets': '10',
      'fetch-retries': 23,
      _authToken: 'deadbeef',
      '//registry.npmjs.org:_authToken': 'c0ffee',
      '@myscope:registry': 'https://my-other.registry.internet/'
    }
  }, {
    rootPkg: require('../../../package.json')
  })

  t.equal(opts.ca, 'idk', 'ca passed through as-is')
  t.equal(opts.cache.replace(/[\\]/g, '/'), '/foo/_cacache', 'cache path has _cacache appended')
  t.equal(opts.maxSockets, 10, 'maxSockets converted to number')
  t.equal(opts.retry.retries, 23, 'retries put into object')
  t.similar(opts.auth, {
    token: 'deadbeef',
    '//registry.npmjs.org': {
      token: 'c0ffee'
    }
  })
  t.deepEqual(opts.scopeTargets, {
    '@myscope': 'https://my-other.registry.internet/'
  }, 'scope target included')
  t.done()
})
