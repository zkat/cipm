'use strict'

const EventEmitter = require('events').EventEmitter

module.exports = () => {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()

  return child
}
