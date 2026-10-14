import test from 'node:test';
import assert from 'node:assert/strict';
import { words, similarity, literalText, textChecks, floorPx, typePx, roleOf, normaliseLines } from '../../src/gate/text.mjs';
import { HOUSE_FLOORS } from '../../src/gate/consts.mjs';

const line = (text, x, y, w, h, conf = 0.9) => ({ text, x, y, w, h, conf });

test('words drops punctuation and bullets', () => {
  assert.deepEqual(words('$5,000,000 · Many decisions.'), ['5000000', 'many', 'decisions']);
});

test('similarity is the difflib ratio', () => {
  assert.equal(similarity('abcd', 'abcd'), 1);
  assert.ok(Math.abs(similarity('decisions', 'decision') - 16 / 17) < 1e-9);
  assert.ok(Math.abs(similarity('5000000', '900000') - 10 / 13) < 1e-9);
  assert.equal(similarity('abc', 'xyz'), 0);
});

test('literalText: short copy is literal, prose and described text are not', () => {
  assert.equal(literalText({ text: 'Many decisions.' }), true);
  assert.equal(literalText({ text: 'one two three four five six seven eight nine ten eleven' }), false);
  assert.equal(literalText({ text: 'Sage', literal: false }), false);
  assert.equal(literalText({ text: 'Sage', order_text: 'the big blue dot' }), false);
});

test('legibility floors follow the house rules and scale with the width', () => {
  assert.deepEqual(HOUSE_FLOORS, { headline: 60, body: 40, caption: 30, url: 26 });
  assert.equal(floorPx('headline', 1080), 60);
  assert.equal(floorPx('caption', 1920), (30 * 1920) / 1080);
  assert.equal(floorPx('url', 540), 13);
  assert.equal(roleOf({ role: 'body' }, 'x'), 'body');
  assert.equal(roleOf({}, 'example.com'), 'url');
  assert.equal(roleOf({}, 'Hello there'), 'caption');
});

test('textChecks: a changed number is a near-miss finding', () => {
  const beat = { elements: [{ id: 'amount', text: '$5,000,000' }] };
  const r = textChecks(beat, [line('$500,000', 10, 10, 400, 80)], 77, 1920, 1080, [], null);
  assert.equal(r.filter((x) => x.check === 'text_match').length, 1);
  assert.equal(r.find((x) => x.check === 'text_match').read, '500000');
});

test('textChecks: absent words are not reported, matching text is clean', () => {
  const beat = { elements: [{ id: 'a', text: 'Not yet here' }, { id: 'b', text: 'Sage' }] };
  const r = textChecks(beat, [line('Sage', 10, 10, 200, 90)], 5, 1920, 1080, [], null);
  assert.equal(r.length, 0);
});

test('textChecks: text under the caption floor is a finding; the same height passes on a narrower video', () => {
  const beat = { elements: [{ id: 'label', text: 'BUILT WITH SAGE' }] };
  const small = [line('BUILT WITH SAGE', 100, 900, 400, 19)];
  const wide = textChecks(beat, small, 460, 1920, 1080, [], null).find((x) => x.check === 'text_size');
  assert.ok(wide && wide.role === 'caption' && wide.floor_px === 53);
  assert.equal(textChecks(beat, small, 460, 540, 304, [], null).filter((x) => x.check === 'text_size').length, 0);
  const okLine = [line('BUILT WITH SAGE', 100, 900, 400, 45)];
  assert.equal(textChecks(beat, okLine, 460, 1920, 1080, [], null).length, 0);
});

test('textChecks: a headline role raises the floor', () => {
  const beat = { elements: [{ id: 'h', text: 'One call.', role: 'headline' }] };
  const r = textChecks(beat, [line('One call.', 100, 200, 600, 60)], 1, 1080, 1920, [], null);   // 60 / 0.7 = 86 px type: fine
  assert.equal(r.length, 0);
  const small = textChecks(beat, [line('One call.', 100, 200, 600, 30)], 1, 1080, 1920, [], null).find((x) => x.check === 'text_size');   // 43 px
  assert.equal(small.role, 'headline');
  assert.equal(small.floor_px, 60);
});

test('textChecks: type close to a masked object', () => {
  const beat = { elements: [] };
  const masks = [{ id: 'hand', rect: [0, 700, 760, 1080] }];
  const near = textChecks(beat, [line('to build Sage.', 300, 690, 300, 50)], 277, 1920, 1080, masks, null);
  assert.equal(near.length, 1); assert.equal(near[0].check, 'type_over_object');
  assert.equal(textChecks(beat, [line('far away', 1000, 100, 300, 50)], 277, 1920, 1080, masks, null).length, 0);
  assert.equal(textChecks(beat, [line('to build Sage.', 300, 690, 300, 50)], 277, 1920, 1080, [{ ...masks[0], frames: [300, 400] }], null).length, 0);
});

test('normaliseLines maps the OCR shape and scales a 0..100 confidence', () => {
  const [l] = normaliseLines([{ text: 'Hi', bbox: { x0: 10, y0: 20, x1: 60, y1: 50 }, confidence: 87 }]);
  assert.deepEqual(l, { text: 'Hi', x: 10, y: 20, w: 50, h: 30, conf: 0.87 });
});
