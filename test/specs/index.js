'use strict'

const test = require('tap').test
const requireInject = require('require-inject')
const fixtureHelper = require('../lib/fixtureHelper.js')

let config = {}
let extract = () => {}
const dir = 'index'
const main = requireInject('../../index.js', {
  '../../lib/config': () => {
    return config
  },
  '../../lib/extract': {
    startWorkers () {},
    stopWorkers () {},
    child (...args) {
      return extract(...args)
    }
  }
})

test('throws error when no package.json is found', t => {
  const prefix = fixtureHelper.write(dir, {
    'index.js': 'var a = 1;'
  })

  main({ prefix: prefix }).catch(err => {
    t.equal(err.code, 'ENOENT')

    fixtureHelper.teardown()
    t.end()
  })
})

test('throws error when no package-lock nor shrinkwrap is found', t => {
  const prefix = fixtureHelper.write(dir, {
    'package.json': {}
  })

  main({ prefix: prefix }).catch(err => {
    t.equal(err.message, 'cipm can only install packages with an existing package-lock.json or npm-shrinkwrap.json with lockfileVersion >= 1. Run an install with npm@5 or later to generate it, then try again.')

    fixtureHelper.teardown()
    t.end()
  })
})

test('throws error when old shrinkwrap is found', t => {
  const prefix = fixtureHelper.write(dir, {
    'package.json': {},
    'npm-shrinkwrap.json': {}
  })

  main({ prefix: prefix }).catch(err => {
    t.equal(err.message, 'cipm can only install packages with an existing package-lock.json or npm-shrinkwrap.json with lockfileVersion >= 1. Run an install with npm@5 or later to generate it, then try again.')

    fixtureHelper.teardown()
    t.end()
  })
})

test('handles empty dependency list', t => {
  const prefix = fixtureHelper.write(dir, {
    'package.json': {},
    'package-lock.json': {
      dependencies: {},
      lockfileVersion: 1
    }
  })

  main({ prefix: prefix }).then(details => {
    t.equal(details.count, 0)

    fixtureHelper.teardown()
    t.end()
  })
})

test('handles dependency list with only shallow subdeps', t => {
  const prefix = fixtureHelper.write(dir, {
    'package.json': {},
    'package-lock.json': {
      dependencies: {
        a: {}
      },
      lockfileVersion: 1
    }
  })

  const aContents = 'var a = 1;'

  extract = fixtureHelper.getWriter(dir, {
    '/node_modules/a': {
      'package.json': {},
      'index.js': aContents
    }
  })

  main({ prefix: prefix }).then(details => {
    t.equal(details.count, 1)
    t.ok(fixtureHelper.equals(prefix + '/node_modules/a', 'index.js', aContents))

    fixtureHelper.teardown()
    t.end()
  })
})

test('handles dependency list with only deep subdeps', t => {
  const prefix = fixtureHelper.write(dir, {
    'package.json': {},
    'package-lock.json': {
      dependencies: {
        a: {
          dependencies: {
            b: {}
          }
        }
      },
      lockfileVersion: 1
    }
  })

  const aContents = 'var a = 1;'
  const bContents = 'var b = 2;'

  extract = fixtureHelper.getWriter(dir, {
    '/node_modules/a': {
      'package.json': {},
      'index.js': aContents
    },
    '/node_modules/a/node_modules/b': {
      'package.json': {},
      'index.js': bContents
    }
  })

  main({ prefix: prefix }).then(details => {
    t.equal(details.count, 2)
    t.ok(fixtureHelper.equals(prefix + '/node_modules/a', 'index.js', aContents))
    t.ok(fixtureHelper.equals(prefix + '/node_modules/a/node_modules/b', 'index.js', bContents))

    fixtureHelper.teardown()
    t.end()
  })
})
