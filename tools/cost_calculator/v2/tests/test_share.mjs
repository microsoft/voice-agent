import assert from 'node:assert/strict';
import test from 'node:test';
import {DEFAULTS} from '../web/inputs.mjs';
import {settingsFromQuery, settingsQuery} from '../web/share.mjs';

test('a link holds the option and only the inputs that differ from the defaults, and opens the same settings', () => {
  const params = {...DEFAULTS, minutes: 30, promptDesign: 'stage', stages: 6, summarise: true, callerTalkPercent: 70, agentTalkPercent: 25};
  const query = settingsQuery('gpt-4.1@byom', params);
  assert.deepEqual([...new URLSearchParams(query).keys()].sort(),
    ['agentTalkPercent', 'callerTalkPercent', 'minutes', 'option', 'promptDesign', 'stages', 'summarise']);
  assert.deepEqual(settingsFromQuery(`?${query}`, 'gpt-realtime-2.1@managed'), {option: 'gpt-4.1@byom', params, ignored: []});
  assert.equal(settingsQuery('gpt-realtime-2.1@managed', DEFAULTS), 'option=gpt-realtime-2.1%40managed');
});

test('a link with unknown or invalid settings opens the rest and names what it ignored', () => {
  const {option, params, ignored} = settingsFromQuery('?option=nope&minutes=abc&stages=7&foo=1&summarise=maybe', 'gpt-realtime-2.1@managed');
  assert.equal(option, 'gpt-realtime-2.1@managed');
  assert.equal(params.stages, 7);
  assert.equal(params.minutes, DEFAULTS.minutes);
  assert.equal(params.summarise, DEFAULTS.summarise);
  assert.deepEqual([...ignored].sort(), ['foo', 'minutes', 'option', 'summarise']);
  // An alias opens its option; talk time is checked as a pair, so raising one share and lowering the other works.
  assert.equal(settingsFromQuery('?option=rt21-pro', 'x').option, 'gpt-realtime-2.1@managed');
  assert.deepEqual(settingsFromQuery('?callerTalkPercent=70&agentTalkPercent=25', 'x').ignored, []);
});
