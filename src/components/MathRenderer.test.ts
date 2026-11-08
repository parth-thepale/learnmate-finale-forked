import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMathSegments, renderKaTeXToString } from './MathRenderer';

test('MathRenderer 1: parses inline math with $ delimiters', () => {
  const text = 'The quadratic solution is $x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$ where $a \\neq 0$.';
  const segments = parseMathSegments(text);

  assert.equal(segments.length, 5);
  assert.equal(segments[0].type, 'text');
  assert.equal(segments[0].content, 'The quadratic solution is ');
  assert.equal(segments[1].type, 'inline-math');
  assert.equal(segments[1].content, 'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}');
  assert.equal(segments[2].type, 'text');
  assert.equal(segments[2].content, ' where ');
  assert.equal(segments[3].type, 'inline-math');
  assert.equal(segments[3].content, 'a \\neq 0');
  assert.equal(segments[4].type, 'text');
  assert.equal(segments[4].content, '.');
});

test('MathRenderer 2: parses block math with $$ and \\[ \\] delimiters', () => {
  const text = 'Standard Gaussian integral:\n$$\\int_{-\\infty}^\\infty e^{-x^2} dx = \\sqrt{\\pi}$$\nDerived by Poisson.';
  const segments = parseMathSegments(text);

  assert.equal(segments.length, 3);
  assert.equal(segments[0].type, 'text');
  assert.equal(segments[1].type, 'block-math');
  assert.equal(segments[1].content, '\\int_{-\\infty}^\\infty e^{-x^2} dx = \\sqrt{\\pi}');
  assert.equal(segments[2].type, 'text');
});

test('MathRenderer 3: parses alternative \\( \\) and \\[ \\] delimiters', () => {
  const text = 'Here is inline \\(\\lambda = \\frac{h}{p}\\) and block:\n\\[E = mc^2\\]';
  const segments = parseMathSegments(text);

  assert.equal(segments.length, 4);
  assert.equal(segments[1].type, 'inline-math');
  assert.equal(segments[1].content, '\\lambda = \\frac{h}{p}');
  assert.equal(segments[3].type, 'block-math');
  assert.equal(segments[3].content, 'E = mc^2');
});

test('MathRenderer 4: renderKaTeXToString produces valid HTML with fractions and roots', () => {
  const math = '\\frac{G M_1 M_2}{r^2}';
  const html = renderKaTeXToString(math, false);

  assert.ok(html.includes('katex'));
  assert.ok(html.includes('mfrac'));
});

test('MathRenderer 5: handles malformed LaTeX gracefully without throwing', () => {
  const brokenMath = '\\frac{unclosed';
  assert.doesNotThrow(() => {
    const html = renderKaTeXToString(brokenMath, false);
    assert.ok(typeof html === 'string');
    assert.ok(html.length > 0);
  });
});

test('MathRenderer 6: renders Greek letters and vectors', () => {
  const vectorMath = '\\vec{F} = m \\vec{a} + q(\\vec{v} \\times \\vec{B})';
  const html = renderKaTeXToString(vectorMath, false);

  assert.ok(html.includes('katex'));
});

test('MathRenderer 7: preserves escaped dollar signs as regular text', () => {
  const text = 'Item price is \\$100 and equation is $x = 5$.';
  const segments = parseMathSegments(text);

  assert.equal(segments.length, 3);
  assert.equal(segments[0].type, 'text');
  assert.ok(segments[0].content.includes('\\$100'));
  assert.equal(segments[1].type, 'inline-math');
  assert.equal(segments[1].content, 'x = 5');
  assert.equal(segments[2].type, 'text');
  assert.equal(segments[2].content, '.');
});
