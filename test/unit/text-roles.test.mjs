import test from 'node:test';
import assert from 'node:assert/strict';
import { rolelessText, TEXT_ROLES } from '../../src/core/schedule.mjs';

test('rolelessText lists text elements without a role, and only those', () => {
  const s = { beats: [{ id: 'intro', elements: [
    { id: 'title', text: 'Sage', role: 'headline' },
    { id: 'note', text: 'Leaked list' },
    { id: 'bar' },                                       // no text: not a text element
    { id: 'link', text: 'sage.levanto.ai', role: 'url' },
    { id: 'odd', text: 'x', role: 'shouting' },          // a role that does not exist counts as no role
  ] }] };
  assert.deepEqual(rolelessText(s), ['intro/note', 'intro/odd']);
  assert.deepEqual(TEXT_ROLES, ['headline', 'body', 'caption', 'url']);
});
