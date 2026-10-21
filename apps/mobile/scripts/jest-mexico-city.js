/**
 * Node reads TZ when the process starts. This wrapper sets it before Jest,
 * so an outer TZ=UTC or TZ=Asia/Tokyo does not change the suite.
 */
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const jestBin = path.join(path.dirname(require.resolve('jest/package.json')), 'bin', 'jest.js');
const result = spawnSync(process.execPath, [jestBin, '--ci', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, TZ: 'America/Mexico_City' },
  cwd: path.join(__dirname, '..'),
});

process.exit(result.status === null ? 1 : result.status);
