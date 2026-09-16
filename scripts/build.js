#!/usr/bin/env node
// Packages server.js into standalone executables for Windows, macOS, and
// Linux (no Node.js install required to run them) using @yao-pkg/pkg, then
// copies the static assets each build needs to find next to itself.
//
// pkg fetches a prebuilt Node.js binary for every target below and stitches
// it together with a snapshot of this app, so all four builds run from a
// single host (no cross-compiler or target OS needed) — only network access
// to fetch those prebuilt bases the first time (cached afterward).
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const PKG_BIN = path.join(ROOT, 'node_modules', '.bin', 'pkg');

const TARGETS = [
  { pkgTarget: 'node22-win-x64', dir: 'time-tracker-win-x64', bin: 'time-tracker.exe' },
  { pkgTarget: 'node22-macos-x64', dir: 'time-tracker-macos-x64', bin: 'time-tracker' },
  { pkgTarget: 'node22-macos-arm64', dir: 'time-tracker-macos-arm64', bin: 'time-tracker' },
  { pkgTarget: 'node22-linux-x64', dir: 'time-tracker-linux-x64', bin: 'time-tracker' },
];

// Static assets a running build reads from disk at its own location (see
// BASE_DIR in server.js) rather than from pkg's embedded snapshot, so real
// user data (data/) stays a plain, writable, editable CSV file next to the
// executable instead of being locked inside it. csv-parse/csv-stringify ride
// along the same way because pkg's bundler can't embed their "/sync"
// subpaths (see the matching comment in server.js).
const ASSET_DIRS = [
  'public',
  'mock-data',
  'node_modules/csv-parse',
  'node_modules/csv-stringify',
];

for (const target of TARGETS) {
  const outDir = path.join(DIST, target.dir);
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`\nBuilding ${target.dir}...`);
  execFileSync(
    PKG_BIN,
    [
      'server.js',
      '--target', target.pkgTarget,
      '--output', path.join(outDir, target.bin),
      '--compress', 'Brotli',
      // V8 bytecode caches are tied to the exact V8 build that generated
      // them. Cross-compiling from this (Linux x64) host produces bytecode
      // that either fails outright for other CPU archs (arm64) or, worse,
      // looks fine at build time but is rejected as invalid by the real
      // target's V8 at actual runtime (seen on real Windows: "[pkg] V8
      // rejected the bytecode cache"). All three flags below are needed
      // together to actually skip it: --no-bytecode alone errors ("no
      // source") because pkg still strips the original source unless
      // --public/--public-packages tell it to keep and disclose it instead.
      '--no-bytecode',
      '--public-packages', '*',
      '--public',
    ],
    { cwd: ROOT, stdio: 'inherit' },
  );

  for (const assetDir of ASSET_DIRS) {
    fs.cpSync(path.join(ROOT, assetDir), path.join(outDir, assetDir), { recursive: true });
  }
}

console.log(`\nDone. Builds are in ${path.relative(ROOT, DIST)}/, one folder per platform.`);
