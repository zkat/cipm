'use strict'

const BB = require('bluebird')
const fs = require('fs')
const mkdirp = require('mkdirp')
const resolve = require('path').resolve
const pathSep = require('path').sep
const rimraf = require('rimraf')

function getPath (dir) {
  return resolve(__dirname, '..', 'fixtures', dir.replace(/\//g, pathSep))
}

function writeFile (path, name, contents) {
  if (typeof contents === 'object') {
    contents = JSON.stringify(contents, null, 2)
  }
  fs.writeFileSync(resolve(path, name), contents)
}

function writeFiles (path, fs) {
  Object.keys(fs).forEach(fileName => {
    const filePath = fileName.replace(/\//g, pathSep)
    writeFile(path, filePath, fs[fileName])
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
  read (dir, name) {
    const path = getPath(dir)
    return fs.readFileSync(resolve(path, name)).toString()
  },
  missing (dir, name) {
    const path = getPath(dir)
    try {
      return !fs.accessSync(resolve(path, name))
    } catch (e) {
      return e.code === 'ENOENT'
    }
  },
  teardown () {
    rimraf.sync(getPath(''))
  },
  getWriter (dir, fs) {
    const path = getPath(dir)
    return (_, child, childPath) => {
      mkdirp.sync(childPath)
      const pathSuffix = childPath.replace(path, '').replace(/\\/g, '/')
      writeFiles(childPath, fs[pathSuffix])
      return BB.resolve()
    }
  }
}
