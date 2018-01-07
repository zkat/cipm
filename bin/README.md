[![npm](https://img.shields.io/npm/v/cipm.svg)](https://npm.im/cipm) [![license](https://img.shields.io/npm/l/cipm.svg)](https://npm.im/cipm) [![Travis](https://img.shields.io/travis/zkat/cipm.svg)](https://travis-ci.org/zkat/cipm) [![AppVeyor](https://ci.appveyor.com/api/projects/status/github/zkat/cipm?svg=true)](https://ci.appveyor.com/project/zkat/cipm) [![Coverage Status](https://coveralls.io/repos/github/zkat/cipm/badge.svg?branch=latest)](https://coveralls.io/github/zkat/cipm?branch=latest)

## NOTE: this project is under active development. Please don't use it yet.

# cipm(1) -- install npm dependencies from a package lock

## SYNOPSIS

`cipm [--userconfig <path>] [--ignore-scripts] [--offline] [--loglevel <level>]`

## INSTALL

`npm install [-g|-D] cipm`

## DESCRIPTION

When invoked inside an npm project with a `package.json` and `package-lock.json` (or an `npm-shrinkwrap.json`), it will install the specified dependencies and run their install scripts.

The main difference between this and `npm install` is that `cipm` is both a small, standalone program, and that it can bypass a lot of the heavier machinery in npm oriented towards interacting with invalid states: `cipm` completely removes `node_modules` before beginning the install, if it exists.

`cipm` also requires that the current project have an existing lockfile, which must first be generated using `npm install` in `npm@5` or later versions (or any other package manager supporting `lockfileVersion@>=1`).

This tool is ideal for using in CI environments that require regular, full installs of an application, but that are usually able to cache package data in a central cache.

## EXAMPLES

## AUTHOR

Written by [Kat Marchan](https://github.com/zkat).

## REPORTING BUGS

Please file any relevant issues [on Github.](https://github.com/zkat/cipm)

## LICENSE

This work is released under the conditions of the MIT license. See LICENSE.md for more details.

## SEE ALSO

* `npm-install(1)`
* `npm-package-locks(5)`
* `package-lock.json(5)`
