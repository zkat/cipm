'use strict'

const BB = require('bluebird')
const fs = require('fs')
const mkdirp = require('mkdirp')
const resolve = require('path').resolve
const rimraf = require('rimraf')

function getPath (dir) {
  return resolve(__dirname, '..', 'fixtures', dir)
}

function writeFile (path, name, contents) {
  if (typeof contents === 'object') {
    contents = JSON.stringify(contents, null, 2)
  }
  fs.writeFileSync(resolve(path, name), contents)
}

function writeFiles (path, fs) {
  Object.keys(fs).forEach(fileName => {
    writeFile(path, fileName, fs[fileName])
  })
}

function setup (dir) {
  const path = getPath(dir)
  rimraf.sync(path)
  mkdirp.sync(path)
  return path
}

module.exports = {
  write (dir, fs) {
    const path = setup(dir)
    writeFiles(path, fs)
    return path
  },
  equals (dir, name, expected) {
    const path = getPath(dir)
    if (typeof expected === 'object') {
      expected = JSON.stringify(expected, null, 2)
    }

    return expected === fs.readFileSync(resolve(path, name)).toString()
  },
  teardown () {
    rimraf.sync(getPath(''))
  },
  getWriter (dir, fs) {
    const path = getPath(dir)
    return (_, child, childPath) => {
      mkdirp.sync(childPath)
      const pathSuffix = childPath.replace(path, '')
      writeFiles(childPath, fs[pathSuffix])
      return BB.resolve()
    }
  }
}
