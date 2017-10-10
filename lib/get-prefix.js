'use strict'

const fs = require('fs')
const path = require('path')
const util = require('util')

let statAsync
if (util.promisify) {
  statAsync = util.promisify(require('fs').stat)
} else {
  statAsync = f => new Promise((resolve, reject) => {
    fs.stat(f, (err, stat) => err ? reject(err) : resolve(stat))
  })
}

module.exports = getPrefix
function getPrefix (current, root) {
  if (!root) {
    const original = root = path.resolve(current)
    while (path.basename(root) === 'node_modules') {
      root = path.dirname(root)
    }
    if (original !== root) {
      return Promise.resolve(root)
    } else {
      return getPrefix(root, root)
    }
  }
  if (isRootPath(current, process.platform)) {
    return Promise.resolve(root)
  } else {
    return Promise.all([
      fileExists(path.join(current, 'package.json')),
      fileExists(path.join(current, 'node_modules'))
    ]).then(args => {
      const hasPkg = args[0]
      const hasModules = args[1]
      if (hasPkg || hasModules) {
        return current
      } else {
        const parent = path.dirname(current)
        return getPrefix(parent, root)
      }
    })
  }
}

module.exports._fileExists = fileExists
function fileExists (f) {
  return statAsync(f).catch(err => {
    if (err.code !== 'ENOENT') {
      throw err
    }
  })
}

module.exports._isRootPath = isRootPath
function isRootPath (p, platform) {
  return platform === 'win32'
  ? p.match(/^[a-z]+:[/\\]?$/i)
  : p === '/'
}
