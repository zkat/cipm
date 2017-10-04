'use strict'

const Buffer = require('safe-buffer').Buffer

const crypto = require('crypto')
const path = require('path')

let effectiveOwner

const npmSession = crypto.randomBytes(8).toString('hex')

module.exports = pacoteOpts
function pacoteOpts (npmOpts, moreOpts) {
  const conf = npmOpts.config
  const ownerStats = calculateOwner()
  const opts = {
    cache: path.join(conf['cache'], '_cacache'),
    ca: conf['ca'],
    cert: conf['cert'],
    git: conf['git'],
    key: conf['key'],
    localAddress: conf['local-address'],
    loglevel: conf['loglevel'],
    maxSockets: +(conf['maxsockets'] || 15),
    npmSession: npmSession,
    offline: conf['offline'],
    projectScope: getProjectScope((npmOpts.rootPkg || moreOpts.rootPkg).name),
    proxy: conf['https-proxy'] || conf['proxy'],
    refer: 'cipm',
    registry: conf['registry'],
    retry: {
      retries: conf['fetch-retries'],
      factor: conf['fetch-retry-factor'],
      minTimeout: conf['fetch-retry-mintimeout'],
      maxTimeout: conf['fetch-retry-maxtimeout']
    },
    strictSSL: conf['strict-ssl'],
    userAgent: conf['user-agent'],

    dmode: parseInt('0777', 8) & (~conf['umask']),
    fmode: parseInt('0666', 8) & (~conf['umask']),
    umask: conf['umask']
  }

  if (ownerStats.uid != null || ownerStats.gid != null) {
    Object.assign(opts, ownerStats)
  }

  Object.keys(conf).forEach(k => {
    const authMatchGlobal = k.match(
      /^(_authToken|username|_password|password|email|always-auth|_auth)$/
    )
    const authMatchScoped = k[0] === '/' && k.match(
      /(.*):(_authToken|username|_password|password|email|always-auth|_auth)$/
    )

    // if it matches scoped it will also match global
    if (authMatchGlobal || authMatchScoped) {
      let nerfDart = null
      let key = null
      let val = null

      if (!opts.auth) { opts.auth = {} }

      if (authMatchScoped) {
        nerfDart = authMatchScoped[1]
        key = authMatchScoped[2]
        val = conf[k]
        if (!opts.auth[nerfDart]) {
          opts.auth[nerfDart] = {
            alwaysAuth: !!conf['always-auth']
          }
        }
      } else {
        key = authMatchGlobal[1]
        val = conf[k]
        opts.auth.alwaysAuth = !!conf['always-auth']
      }

      const auth = authMatchScoped ? opts.auth[nerfDart] : opts.auth
      if (key === '_authToken') {
        auth.token = val
      } else if (key.match(/password$/i)) {
        auth.password =
        // the config file stores password auth already-encoded. pacote expects
        // the actual username/password pair.
        Buffer.from(val, 'base64').toString('utf8')
      } else if (key === 'always-auth') {
        auth.alwaysAuth = val === 'false' ? false : !!val
      } else {
        auth[key] = val
      }
    }

    if (k[0] === '@') {
      if (!opts.scopeTargets) { opts.scopeTargets = {} }
      opts.scopeTargets[k.replace(/:registry$/, '')] = conf[k]
    }
  })

  Object.keys(moreOpts || {}).forEach((k) => {
    opts[k] = moreOpts[k]
  })

  return opts
}

function calculateOwner () {
  if (!effectiveOwner) {
    effectiveOwner = { uid: 0, gid: 0 }

    // Pretty much only on windows
    if (!process.getuid) {
      return effectiveOwner
    }

    effectiveOwner.uid = +process.getuid()
    effectiveOwner.gid = +process.getgid()

    if (effectiveOwner.uid === 0) {
      if (process.env.SUDO_UID) effectiveOwner.uid = +process.env.SUDO_UID
      if (process.env.SUDO_GID) effectiveOwner.gid = +process.env.SUDO_GID
    }
  }

  return effectiveOwner
}

function getProjectScope (pkgName) {
  const sep = pkgName.indexOf('/')
  if (sep === -1) {
    return ''
  } else {
    return pkgName.slice(0, sep)
  }
}
