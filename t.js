const { chromium } = require('playwright'); const L = require('./src/logic.js'); global.DATA = require('./src/data.js');
(async () => {
  // node t.js desktop ROLE PICKS [ALLEGIANCE]   ALLEGIANCE: 0 = loyal (default), or 1-3 = double agent falsifying that report,
  // optionally followed by the lie: F (the report's first false version, default) or O (its second), e.g. 2O
  const mode = process.argv[2] || 'desktop', role = process.argv[3] || 'BP', picks = process.argv[4] || 'ABCABC', algArg = process.argv[5] || '0', alg = +algArg[0], lv = algArg[1] === 'O' ? 'O' : 'F';
  const b = await chromium.launch(); const ctx = await b.newContext(mode === 'mobile' ? { viewport: { width: 400, height: 860 } } : { viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push('PAGEERR ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|fonts/.test(m.text())) errs.push('CONSOLE ' + m.text()); });
  await p.goto('file://' + process.cwd() + '/dist/test.html'); await p.waitForTimeout(400); await p.screenshot({ path: `shots/${mode}-title.png`, fullPage: true });
  await p.click('#start'); await p.click(`.rolecard[data-r="${role}"]`); await p.fill('#cname', 'Marta'); await p.screenshot({ path: `shots/${mode}-pick.png`, fullPage: true }); await p.click('#begin');
  for (let r = 0; r < 6; r++) {
    await p.click('#next'); if (r === 0) await p.screenshot({ path: `shots/${mode}-brief.png`, fullPage: true });
    { const k = L.shiftFor(role, r); for (let i = 0; i < k; i++) await p.click('#dp'); }
    await p.waitForSelector('.mitem'); if (r === 0) await p.screenshot({ path: `shots/${mode}-work.png`, fullPage: true });
    await p.keyboard.press(picks[r].toLowerCase()); if(r===0) await p.screenshot({ path: `shots/${mode}-selected.png`, fullPage: true }); await p.click('#send'); await p.waitForSelector('#next',{state:'attached'}); if (r === 0) await p.screenshot({ path: `shots/${mode}-outcome.png`, fullPage: true }); await p.click('#next');
  }
  // 1945 epilogue, then Trust or Traitor: choose the secret allegiance
  await p.waitForSelector('#epinext'); if (!/1945/.test(await p.textContent('main'))) errs.push('EPILOGUE missing 1945'); await p.screenshot({ path: `shots/${mode}-epilogue.png`, fullPage: true }); await p.click('#epinext');
  await p.waitForSelector('[data-al]');
  if (alg) { await p.click('[data-al="D"]'); await p.click(`[data-lie="${alg}"]`); if (!(await p.isDisabled('#alok'))) errs.push('SEAL allowed before a lie was chosen'); await p.click(`[data-lv="${lv}"]`); } else await p.click('[data-al="0"]');
  await p.waitForTimeout(600); await p.screenshot({ path: `shots/${mode}-allegiance.png`, fullPage: true }); await p.click('#alok');
  await p.waitForSelector('#sigid'); const id = await p.textContent('#sigid'); console.log('signal', id);
  const pa = L.parseSignal(id); if (!pa || pa.alleg !== alg || (alg && pa.lie !== lv)) errs.push('ALLEGIANCE did not round-trip: ' + id);
  // the post carries the Signal ID, questions and a CLASSIFIED intel block, but never the report text (that unlocks only by decoding)
  const post = await p.inputValue('#ptext'); if (!/INTEL REPORTS FROM MY FRONT \(CLASSIFIED\)/.test(post) || !/█{10}/.test(post)) errs.push('POST has no classified intel block');
  if (!post.includes('SIGNAL ID: ' + id)) errs.push('POST has no Signal ID');
  DATA.INTEL[role].forEach((x) => [x.truth, x.fake, x.third].forEach((w) => { if (post.includes(x.t.replace('{X}', w))) errs.push('POST leaks a report: ' + w); }));
  if (/Secrecy \d|Badges:|Score \d/.test(post)) errs.push('POST repeats card details');
  await p.selectOption('#qsel2', '4'); if (!/QUESTIONS FOR YOU\n1\. .+\n2\. /.test(await p.inputValue('#ptext'))) errs.push('second question not added');
  await p.screenshot({ path: `shots/${mode}-end.png`, fullPage: true });
  // decode another role (a double agent who falsified report 2), use the Archive, interrogate
  const o = role === 'NV' ? 'BP' : 'NV'; const S = L.newState(L.roleById(o), 'x'); for (let r = 0; r < 6; r++) { S.i = r; L.choose(S, r % 3); } S.alg = { v: 2, r: 5 }; const sid = L.signalId(S);
  await p.fill('#sid', sid); await p.click('#dgo'); await p.waitForSelector('.decoded'); await p.waitForSelector('[data-v]');
  { const rt = await p.inputValue('#rtext'); if (!rt.includes('PROOF ' + L.proofCode(id, sid))) errs.push('REPLY has no matching proof code'); }
  await p.click('#iarch'); await p.waitForSelector('.archive .dossier'); await p.click('.ftab:nth-child(2)'); await p.hover('.archive .red'); await p.waitForTimeout(500); await p.screenshot({ path: `shots/${mode}-archive.png` }); await p.keyboard.press('Escape');
  if (/SEAL /.test(await p.inputValue('#rtext'))) errs.push('REPLY has a SEAL before a verdict');
  if (await p.$('.cmp')) errs.push('COMPARE box shown with no teammate decoded'); if (!/Go with your gut/.test(await p.innerText('.interro'))) errs.push('gut-call line missing');
  if (!(await p.isDisabled('#ifile'))) errs.push('verdict could be sealed with no choice');
  await p.click('[data-v="D"]'); await p.click('#ifile');
  { const rt = await p.inputValue('#rtext'); if (!rt.includes('SEAL ' + L.sealCode(id, sid, 1))) errs.push('REPLY has no matching SEAL:\n' + rt); } await p.waitForSelector('.vfiled'); await p.screenshot({ path: `shots/${mode}-decoded.png`, fullPage: true });
  await p.click('[data-go="board"]'); await p.waitForTimeout(200); await p.screenshot({ path: `shots/${mode}-board.png`, fullPage: true });
  const bd = await p.evaluate(() => JSON.parse(localStorage.getItem('cb_board'))); const v = (bd.verdicts || {})[sid];
  if (!v || v.v !== 'D' || Object.keys(v).length !== 1) errs.push('VERDICT not stored as expected: ' + JSON.stringify(v));
  // a loyal teammate of the double agent: the comparison shows report 2 differs
  const S2 = L.newState(L.roleById(o), 'y'); for (let r = 0; r < 6; r++) { S2.i = r; L.choose(S2, (r + 1) % 3); } S2.alg = { v: 0, r: 1 }; const sid2 = L.signalId(S2);
  await p.fill('#sid', sid2); await p.click('#dgo'); await p.waitForSelector('.cmprow'); { const c = await p.innerText('.cmp'); if (!c.includes(sid) || !/Report 2 is different/.test(c) || /Report [13] is different/.test(c)) errs.push('COMPARE wrong: ' + c); }
  await p.screenshot({ path: `shots/${mode}-compare.png`, fullPage: true });
  // Who trusted you?: two classmates' seals for this player's card (one trust, one traitor), one pasted twice
  await p.fill('#sealin', 'DECODED x\nSEAL ' + L.sealCode(sid, id, 0) + '\nblah\nSEAL ' + L.sealCode(sid2, id, 1) + '\nSEAL ' + L.sealCode(sid2, id, 1)); await p.click('#sealgo'); await p.waitForSelector('.sealres');
  { const t = await p.innerText('.seals'); const want = alg ? 'You fooled 1 of 2' : '1 trusted you'; if (!t.includes(want) || !/Opened 2 new seals\. 1 already opened/.test(t)) errs.push('SEALS wrong: ' + t); }
  await p.screenshot({ path: `shots/${mode}-seals.png`, fullPage: true });
  if ((await p.evaluate(() => JSON.stringify(localStorage))).indexOf('Marta') >= 0) errs.push('NAME was saved');
  console.log(errs.length ? errs.join('\n') : 'no errors'); await b.close();
})();
