import assert from 'node:assert/strict';
import { calculate } from '../src/calculator.js';
import { convertAmount } from '../src/public-apis.js';

assert.equal(calculate('1 + 2   '), 3);
assert.equal(calculate(' -2 ^ 2 '), -4);
assert.equal(calculate('2 ^ -2'), 0.25);
assert.equal(calculate('2 ^ 3 ^ 2'), 512);
assert.equal(calculate('2 * (3 + 4)'), 14);
assert.throws(() => calculate('1 / 0'), /divide by zero/);
assert.throws(() => calculate('1 + trailing'), /Only numbers/);
await assert.rejects(convertAmount(-1, 'bitcoin', 'ethereum'), /positive number/);
await assert.rejects(convertAmount(0, 'bitcoin', 'ethereum'), /positive number/);
console.log('Calculator and conversion validation tests passed.');
