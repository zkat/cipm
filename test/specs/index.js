'use strict'

const test = require('tap').test
const requireInject = require('require-inject')
const fixtureHelper = require('../lib/fixtureHelper.js')

let extract = () => {}
const pkgName = 'hark-a-package'
const pkgVersion = '1.0.0'
const writeEnvScript = 'node -e \'const fs = require("fs"); fs.writeFileSync(process.cwd() + "/" + process.env.npm_lifecycle_event, process.env.npm_lifecycle_event);\''

const Installer = requireInject('../../index.js', {
  '../../lib/extract': {
    startWorkers () {},
    stopWorkers () {},
    child () {
      return extract.apply(null, arguments)
    }
  }
})

test('throws error when no package.json is found', t => {
  const prefix = fixtureHelper.write(pkgName, {
    'index.js': 'var a = 1;'
  })

  new Installer({prefix}).run().catch(err => {
    t.equal(err.code, 'ENOENT')

    fixtureHelper.teardown()
    t.end()
  })
})

test('throws error when no package-lock nor shrinkwrap is found', t => {
  const prefix = fixtureHelper.write(pkgName, {
    'package.json': {
      name: pkgName,
      version: pkgVersion
    }
  })

  new Installer({prefix}).run().catch(err => {
    t.equal(err.message, 'cipm can only install packages with an existing package-lock.json or npm-shrinkwrap.json with lockfileVersion >= 1. Run an install with npm@5 or later to generate it, then try again.')

    fixtureHelper.teardown()
    t.end()
  })
})

test('throws error when package.json and package-lock.json do not match', t => {
  const prefix = fixtureHelper.write(pkgName, {
    'package.json': {
      name: pkgName,
      version: pkgVersion,
      dependencies: { a: '1' }, // should generate error
      optionalDependencies: { b: '2' } // should generate warning
    },
    'package-lock.json': {
      version: pkgVersion + '-0',
      dependencies: {},
      lockfileVersion: 1
    }
  })

  new Installer({prefix}).run().catch(err => {
    t.match(err.message, 'cipm can only install packages when your package.json and package-lock.json or npm-shrinkwrap.json are in sync')
    fixtureHelper.teardown()
    t.end()
  })
})

test('throws error when old shrinkwrap is found', t => {
  const prefix = fixtureHelper.write(pkgName, {
    'package.json': {
      name: pkgName,
      version: pkgVersion
    },
    'npm-shrinkwrap.json': {}
  })

  new Installer({prefix}).run().catch(err => {
    t.equal(err.message, 'cipm can only install packages with an existing package-lock.json or npm-shrinkwrap.json with lockfileVersion >= 1. Run an install with npm@5 or later to generate it, then try again.')

    fixtureHelper.teardown()
    t.end()
  })
})

test('handles empty dependency list', t => {
  const prefix = fixtureHelper.write(pkgName, {
    'package.json': {
      name: pkgName,
      version: pkgVersion
    },
    'package-lock.json': {
      dependencies: {},
      lockfileVersion: 1
    }
  })

  new Installer({prefix}).run().then(details => {
    t.equal(details.pkgCount, 0)

    fixtureHelper.teardown()
    t.end()
  })
})

test('handles dependency list with only shallow subdeps', t => {
  const prefix = fixtureHelper.write(pkgName, {
    'package.json': {
      name: pkgName,
      version: pkgVersion
    },
    'package-lock.json': {
      dependencies: {
        a: {}
      },
      lockfileVersion: 1
    }
  })

  const aContents = 'var a = 1;'

  extract = fixtureHelper.getWriter(pkgName, {
    '/node_modules/a': {
      'package.json': {
        name: pkgName,
        version: pkgVersion
      },
      'index.js': aContents
    }
  })

  new Installer({prefix}).run().then(details => {
    t.equal(details.pkgCount, 1)
    t.ok(fixtureHelper.equals(prefix + '/node_modules/a', 'index.js', aContents))

    fixtureHelper.teardown()
    t.end()
  })
})

test('handles dependency list with only deep subdeps', t => {
  const prefix = fixtureHelper.write(pkgName, {
    'package.json': {
      name: pkgName,
      version: pkgVersion
    },
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

  extract = fixtureHelper.getWriter(pkgName, {
    '/node_modules/a': {
      'package.json': {
        name: pkgName,
        version: pkgVersion
      },
      'index.js': aContents
    },
    '/node_modules/a/node_modules/b': {
      'package.json': {
        name: pkgName,
        version: pkgVersion
      },
      'index.js': bContents
    }
  })

  new Installer({prefix}).run().then(details => {
    t.equal(details.pkgCount, 2)
    t.ok(fixtureHelper.equals(prefix + '/node_modules/a', 'index.js', aContents))
    t.ok(fixtureHelper.equals(prefix + '/node_modules/a/node_modules/b', 'index.js', bContents))

    fixtureHelper.teardown()
    t.end()
  })
})

test('runs lifecycle hooks of packages with env variables', t => {
  const originalConsoleLog = console.log
  console.log = () => {}

  const prefix = fixtureHelper.write(pkgName, {
    'package.json': {
      name: pkgName,
      version: pkgVersion,
      scripts: {
        preinstall: writeEnvScript,
        install: writeEnvScript,
        postinstall: writeEnvScript
      }
    },
    'package-lock.json': {
      dependencies: {
        a: {}
      },
      lockfileVersion: 1
    }
  })

  extract = fixtureHelper.getWriter(pkgName, {
    '/node_modules/a': {
      'package.json': {
        name: 'a',
        version: '1.0.0',
        scripts: {
          preinstall: writeEnvScript,
          install: writeEnvScript,
          postinstall: writeEnvScript
        }
      }
    }
  })

  new Installer({prefix}).run().then(details => {
    t.equal(details.pkgCount, 1)
    t.ok(fixtureHelper.equals(prefix, 'preinstall', 'preinstall'))
    t.ok(fixtureHelper.equals(prefix, 'install', 'install'))
    t.ok(fixtureHelper.equals(prefix, 'postinstall', 'postinstall'))
    t.ok(fixtureHelper.equals(prefix + '/node_modules/a', 'preinstall', 'preinstall'))
    t.ok(fixtureHelper.equals(prefix + '/node_modules/a', 'install', 'install'))
    t.ok(fixtureHelper.equals(prefix + '/node_modules/a', 'postinstall', 'postinstall'))

    fixtureHelper.teardown()
    console.log = originalConsoleLog
    t.end()
  })
})
