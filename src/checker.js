/* Teacher checking page: paste students' private submissions and check every Signal ID and message. Nothing is stored or sent anywhere. */
(function () {
  const D = DATA, L = Logic, $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const ID_RE = /\b[A-Z]{2}-[ABC]{6}(?:-[A-Z0-9])?-[A-Z0-9]{2}\b/g;
  /* Trust or Traitor verdicts: "<ID> A" (trust) or "<ID> D" (traitor). Older versions wrote "D2T" and "*"; only A or D counts now. */
  const VD_RE = /\b([A-Z]{2}-[ABC]{6}-[A-Z0-9]-[A-Z0-9]{2})\s+(A|D)(?:[1-3][TFO])?\*?/g;
  const norm = (t) => String(t || "").toUpperCase().replace(/[^A-Z]+/g, " ").trim();
  const roleByName = (n) => D.ROLES.find((r) => norm(r.name) === norm(n));

  /* v11: replies found on the Padlet. The teacher gives Padlet's export (Excel, CSV) or pasted Padlet text; it is read on this computer only.
     Every "DECODED <ID> ... PROOF R-XXX" in it is a reply; a student's reply is one whose code matches one of their own Signal IDs. */
  let padPairs = null;
  function scanPadlet(text) {
    const t = String(text).replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n)).replace(/<[^>]*>/g, " ").toUpperCase();
    const re = /DECODED\s+([A-Z]{2}-[ABC]{6}(?:-[A-Z0-9])?-[A-Z0-9]{2})[\s\S]{0,160}?PROOF\s+(R-[A-Z0-9]{3})/g, out = {}; let m;
    while ((m = re.exec(t))) out[m[1] + "|" + m[2]] = 1;
    return out;
  }
  /* An .xlsx file is a zip of XML files: read them with the browser's own decompression (no libraries, nothing sent). */
  async function unzipText(buf) {
    const dv = new DataView(buf), td = new TextDecoder(); let e = -1;
    for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error("not a zip");
    const n = dv.getUint16(e + 10, true), out = []; let p = dv.getUint32(e + 16, true);
    for (let k = 0; k < n; k++) {
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lho = dv.getUint32(p + 42, true);
      const name = td.decode(new Uint8Array(buf, p + 46, nl)); p += 46 + nl + xl + cl;
      if (!/\.xml$/i.test(name)) continue;
      const data = new Uint8Array(buf, lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true), csize);
      if (method === 0) out.push(td.decode(data));
      else if (method === 8) out.push(td.decode(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer()));
    }
    return out.join("\n");
  }
  function padCount(sub) {
    if (!padPairs) return null; const own = (sub.own || []).filter((o) => L.parseSignal(o)), found = {};
    Object.keys(padPairs).forEach((k) => { const [id, code] = k.split("|"); if (own.indexOf(id) < 0 && own.some((o) => L.proofCode(o, id) === code)) found[id] = 1; });
    const listed = (sub.replies || []).filter((x) => own.some((o) => L.proofCode(o, x.id) === x.code)), missing = listed.filter((x) => !found[x.id]).length;
    return { found: Object.keys(found).length, missing };
  }
  /* A clear result box, so choosing the file visibly does something even before any submissions are checked. */
  function padStatus(kind, html) { const m = $("#padmsg"); if (!m) return; m.className = "padres " + kind; m.innerHTML = html; }
  function setPadlet(text, label) {
    padPairs = scanPadlet(text); const n = Object.keys(padPairs).length, subs = $("#subs").value.trim();
    if (!n) { padPairs = null; padStatus("bad", `<b>No game replies found in ${esc(label)}.</b> The file had ${Math.round(String(text).length / 1000)}k characters of text, but no reply starting with DECODED and a PROOF code. Try Padlet's other export format (Excel or CSV), or open a card on the Padlet, select its comments, copy them and paste them under <i>Or paste text copied from the Padlet</i>.`); return; }
    padStatus("good", `<b>✓ Found ${n} game repl${n === 1 ? "y" : "ies"} on the Padlet</b> in ${esc(label)}.<br>${subs ? "The <b>Replies found on Padlet</b> column in the table below now uses this file." : "Next: paste the students' submissions in the box above and press <b>Check</b>. The <b>Replies found on Padlet</b> column will show each student's replies."}`);
    if (subs) { run(); const t = $("#out table.simple"); if (t) t.scrollIntoView({ block: "start", behavior: "smooth" }); }
  }

  /* Read one submission's text into its parts. */
  function readOne(text) {
    const head = /MISSION COMPLETE\s*·\s*([^\n·]*)(?:·\s*([^\n]*))?/.exec(text) || [];
    const line = (label) => { const m = new RegExp("^\\s*" + label + "\\s*:(.*)$", "mi").exec(text); return m ? m[1] : null; };
    const ownLine = line("My Signal IDs?"), decLine = line("Decoded with Signal IDs from");
    const msgs = {}; text.split(/\r?\n/).forEach((ln) => { const m = /^\s*([1-6])\.\s.*\):\s*(.+)$/.exec(ln); if (m) msgs[+m[1] - 1] = m[2].trim(); });
    const rcLine = line("Reply codes"), replies = []; if (rcLine) { const re = /\b([A-Z]{2}-[ABC]{6}(?:-[A-Z0-9])?-[A-Z0-9]{2})\s+(R-[A-Z0-9]{3})\b/g; let m; while ((m = re.exec(rcLine.toUpperCase()))) replies.push({ id: m[1], code: m[2] }); }
    const vdLine = line("Verdicts"), verdicts = [];
    if (vdLine) { let m; VD_RE.lastIndex = 0; while ((m = VD_RE.exec(vdLine.toUpperCase()))) verdicts.push({ id: m[1], vd: { v: m[2] } }); }
    const refl = (text.split(/^\s*Decoded with Signal IDs from:.*$/mi)[1] || "").replace(/^\s*(Verdicts|Verdicts right|Interrogation score|Reply codes|Most surprising|Why)\s*:.*$/gmi, "").replace(/^\s*In my words\s*:\s*/mi, "");
    return {
      name: (head[1] || "").trim() || "(no name)", roleName: (head[2] || "").trim(),
      own: ownLine === null ? null : (ownLine.toUpperCase().match(ID_RE) || []),
      dec: decLine === null ? [] : (decLine.toUpperCase().match(ID_RE) || []),
      decRaw: decLine, msgs, refl: refl.trim(), verdicts, hasVd: vdLine !== null, replies, hasRc: rcLine !== null
    };
  }

  /* Check one submission. Returns the row for the results table. */
  function check(sub) {
    const notes = [], warn = [], role = roleByName(sub.roleName), covered = {};
    // the student's own game
    let ownOk = false;
    if (sub.own === null || !sub.own.length) {
      warn.push("No own Signal ID in the submission (made with an older version of the game, or edited). Coverage counts their stated role.");
      if (role) covered[role.id] = "own (stated)";
    } else {
      sub.own.forEach((id) => {
        const p = L.parseSignal(id);
        if (!p) { notes.push(`Own Signal ID ${id} is not a real Signal ID.`); return; }
        covered[p.role.id] = "own"; if (!role || p.role.id === role.id) ownOk = true;
      });
      if (role && !ownOk && !notes.length) notes.push(`Says they played ${role.name}, but their own Signal ID is for a different role.`);
      if (!role && sub.own.some((id) => L.parseSignal(id))) ownOk = true;
    }
    // the classmates they decoded
    const bad = [], decRoles = [];
    sub.dec.forEach((id) => { const p = L.parseSignal(id); if (!p) bad.push(id); else { decRoles.push(p.role.id); if (!covered[p.role.id]) covered[p.role.id] = id; } });
    if (bad.length) notes.push(`Not real Signal IDs: ${bad.join(", ")}.`);
    if (sub.decRaw === null) notes.push("No \"Decoded with Signal IDs from\" line.");
    if (sub.own && sub.dec.some((id) => sub.own.indexOf(id) >= 0)) warn.push("Lists their own Signal ID as a decoded classmate.");
    const missing = D.ROLE_IDS.filter((r) => !covered[r]);
    if (missing.length) notes.push(`No Signal ID for: ${missing.map((r) => L.roleById(r).name).join(", ")}.`);
    // the six messages
    let right = 0; const wrong = [];
    D.ROUNDS.forEach((rd, i) => { if (norm(sub.msgs[i]) === norm(rd.msg.join(" "))) right++; else wrong.push(i + 1); });
    if (wrong.length) notes.push(`Message${wrong.length > 1 ? "s" : ""} wrong or missing: round ${wrong.join(", ")}.`);
    // Reply proof codes (v4): each must match one of the student's own Signal IDs and a classmate they decoded. A wrong code is a note to check, not a fail.
    const rc = { good: [], bad: [] };
    sub.replies.forEach((x) => { const real = (sub.own || []).some((o) => L.parseSignal(o) && L.proofCode(o, x.id) === x.code); (real && sub.dec.indexOf(x.id) >= 0 ? rc.good : rc.bad).push(x); });
    if (rc.bad.length) warn.push(`Reply code${rc.bad.length > 1 ? "s that do" : " that does"} not match this student: ${rc.bad.map((x) => x.code).join(", ")} (edited, or copied from someone else).`);
    const ok = !notes.length && (ownOk || sub.own === null || !sub.own.length);
    // Trust or Traitor: rescore every verdict from the Signal IDs (the student's own "Verdicts right" line is ignored)
    const vs = { n: 0, right: 0, list: [] };
    sub.verdicts.forEach((x) => { const p = L.parseSignal(x.id); if (!p || p.alleg == null || (sub.own || []).indexOf(x.id) >= 0) return; const s = L.verdictScore(p.alleg, x.vd); vs.n++; if (s.right) vs.right++; vs.list.push({ id: x.id, p, vd: x.vd, s }); });
    return { rc, sub, role, covered, missing, right, notes, warn, ok, nRoles: D.ROLE_IDS.length - missing.length, vs };
  }

  /* Cross-checks between students: shared own Signal IDs, identical reflections. */
  function crossCheck(rows) {
    const byOwn = {}, byRefl = {};
    rows.forEach((r) => { (r.sub.own || []).forEach((id) => { (byOwn[id] = byOwn[id] || []).push(r.sub.name); }); if (r.sub.refl.length > 15) (byRefl[norm(r.sub.refl)] = byRefl[norm(r.sub.refl)] || []).push(r.sub.name); });
    rows.forEach((r) => {
      (r.sub.own || []).forEach((id) => { const o = byOwn[id].filter((n) => n !== r.sub.name); if (o.length) r.warn.push(`Same own Signal ID as ${o.join(", ")}. Two students can make identical choices, but check.`); });
      const o = r.sub.refl.length > 15 ? byRefl[norm(r.sub.refl)].filter((n) => n !== r.sub.name) : []; if (o.length) r.warn.push(`Same reflection word for word as ${o.join(", ")}.`);
    });
  }

  /* Trust or Traitor: each student as an agent, from classmates' verdicts. pts = classmates who said Trust (loyal: trusted by; double agent: fooled). */
  function agents(rows) {
    const byId = {};
    rows.forEach((r) => (r.sub.own || []).forEach((id) => { const p = L.parseSignal(id); if (p && p.alleg != null) byId[id] = { id, p, name: r.sub.name, row: r, seen: 0, pts: 0, caught: 0 }; }));
    rows.forEach((r) => r.vs.list.forEach((x) => { const a = byId[x.id] || (byId[x.id] = { id: x.id, p: x.p, name: null, seen: 0, pts: 0, caught: 0 }); a.seen++; if (x.vd.v === "A") a.pts++; else a.caught++; }));
    rows.forEach((r) => { r.agent = null; (r.sub.own || []).forEach((id) => { if (byId[id]) r.agent = byId[id]; }); });
    return Object.values(byId);
  }
  function unmaskHTML(rows, ag) {
    if (!ag.length) return `<p class="small">No Trust or Traitor Signal IDs in these submissions (they come from version 3 of the game or later).</p>`;
    const dbl = ag.filter((a) => a.p.alleg), top = (list, f) => { const m = Math.max(0, ...list.map(f)); return m > 0 ? list.filter((x) => f(x) === m) : []; };
    const who = (a) => esc(a.name || "Unknown student") + " · " + esc(a.p.role.name);
    const deceivers = top(dbl, (a) => a.pts), catchers = top(rows.filter((r) => r.vs.n), (r) => r.vs.right);
    return `<div class="unmask"><h2>THE UNMASKING</h2>
      <div class="awards"><div class="box"><p class="sl">BEST DECEIVER</p>${deceivers.length ? deceivers.map((a) => `<p><b>${who(a)}</b><br>fooled ${a.pts} of ${a.seen} classmate${a.seen === 1 ? "" : "s"}</p>`).join("") : "<p>No double agent fooled anyone.</p>"}</div>
      <div class="box"><p class="sl">BEST SPY-CATCHER</p>${catchers.length ? catchers.map((r) => `<p><b>${esc(r.sub.name)}</b><br>right about ${r.vs.right} of ${r.vs.n} agent${r.vs.n === 1 ? "" : "s"}</p>`).join("") : "<p>No verdicts yet.</p>"}</div></div>
      <h3>Who was who</h3><table><thead><tr><th>Agent</th><th>Allegiance</th><th>What classmates decided</th></tr></thead><tbody>${ag.map((a) => `<tr><td>${who(a)}</td><td><b>${a.p.alleg ? "Double agent" : "Loyal"}</b></td><td>${a.seen ? (a.p.alleg ? `fooled ${a.pts}, caught by ${a.caught}` : `trusted by ${a.pts}, suspected by ${a.caught}`) : "nobody here judged them"}</td></tr>`).join("")}</tbody></table>
      <h3>Every planted lie</h3>${dbl.length ? `<ol class="lies">${dbl.map((a) => { const x = L.plantedLie(a.p.role.id, a.p.alleg, a.p.lie); return `<li><b>${who(a)}</b>, report ${a.p.alleg}:<br><span class="lie">Planted: ${esc(x.lie)}</span><br><span class="truth">Truth: ${esc(x.truth)}</span></li>`; }).join("")}</ol>` : "<p>No double agents in these submissions.</p>"}
      <p class="small">Only Signal IDs that appear in pasted submissions are listed. An agent with no name was decoded by someone here but did not submit.</p></div>`;
  }
  function run() {
    const text = $("#subs").value, parts = text.split(/(?=MISSION COMPLETE)/i).filter((t) => /MISSION COMPLETE/i.test(t));
    if (!parts.length) { $("#out").innerHTML = `<p class="err">No submissions found. Each one starts with "MISSION COMPLETE".</p>`; return; }
    const rows = parts.map((t) => check(readOne(t))); crossCheck(rows); const ag = agents(rows);
    const vdCell = (r) => r.vs.n ? `${r.vs.right} of ${r.vs.n} right` : (r.sub.hasVd ? "None filed" : "—");
    const rcCell = (r) => r.rc.good.length ? `${r.rc.good.length}<div class="mono small">${r.rc.good.map((x) => esc(x.code)).join(" ")}</div>` : (r.sub.hasRc ? "0" : "—");
    const agCell = (r) => r.agent ? (r.agent.p.alleg ? `Double: fooled ${r.agent.pts}` : `Loyal: trusted by ${r.agent.pts}`) : "—";
    const nOk = rows.filter((r) => r.ok).length, nNote = rows.filter((r) => r.ok && r.warn.length).length;
    /* Engagement view (v5): Done? plus who each student connected with. "Decoded by" counts other pasted submissions that list this student's own Signal ID. No flag for a low count (teacher's choice). */
    const decodedBy = (r) => rows.filter((o) => o !== r && (r.sub.own || []).some((id) => o.sub.dec.indexOf(id) >= 0)).length;
    const nDec = (r) => r.sub.dec.filter((id) => L.parseSignal(id) && (r.sub.own || []).indexOf(id) < 0).length;
    const padCell = (r) => { const c = padCount(r.sub); return c ? `${c.found} found${c.missing ? `, ${c.missing} listed but not found` : ""}` : (r.sub.hasRc ? String(r.rc.good.length) : "—"); };
    const doneTxt = (r) => r.ok ? (r.warn.length ? "✓ Done, see note" : "✓ Done") : "✗ Not done";
    $("#out").innerHTML = `<p class="sum"><b>${rows.length}</b> submission${rows.length > 1 ? "s" : ""} checked · <b class="ok">${nOk} done</b>${nNote ? ` (${nNote} with a note)` : ""} · <b class="bad">${rows.length - nOk} not done</b></p>
      <table class="simple"><thead><tr><th>Student</th><th>Role</th><th>Done?</th><th>Classmates decoded</th><th>${padPairs ? "Replies found on Padlet" : "Replies posted"}</th><th>Decoded by</th><th>Notes</th></tr></thead><tbody>${rows.map((r) => `<tr class="${r.ok ? (r.warn.length ? "w" : "g") : "b"}">
        <td>${esc(r.sub.name)}</td><td>${esc(r.role ? r.role.name : r.sub.roleName || "?")}</td><td><b>${doneTxt(r)}</b></td><td>${nDec(r)}</td><td>${padCell(r)}</td><td>${decodedBy(r)}</td>
        <td>${r.notes.concat(r.warn).map((n) => `<div>${esc(n)}</div>`).join("") || ""}</td></tr>`).join("")}</tbody></table>
      <div class="row"><button class="btn" id="tsv1">Copy for a spreadsheet</button><span class="small" id="tsv1msg" role="status"></span></div>
      <p class="small"><b>Done?</b> means all six messages are right and all five roles are covered. ${padPairs ? "<b>Replies found on Padlet</b> counts this student's replies in the Padlet file you gave, matched by proof code. <i>Listed but not found</i> means a reply in their submission is not on the Padlet (not posted yet, edited, or deleted)." : "<b>Replies posted</b> counts the reply proof codes in the submission that match the student. To check they are really on the Padlet, add the Padlet's export below the submissions box."} <b>Decoded by</b> counts classmates in this paste who decoded the student, so it grows as more submissions come in.</p>
      <details class="more"><summary>Full details, Trust or Traitor and the Unmasking</summary>
      <table><thead><tr><th>Student</th><th>Role</th><th>Own Signal ID</th><th>Roles covered</th><th>Messages</th><th>Result</th><th>Reply codes</th><th>Verdicts</th><th>As agent</th><th>Notes</th></tr></thead><tbody>${rows.map((r) => `<tr class="${r.ok ? (r.warn.length ? "w" : "g") : "b"}">
        <td>${esc(r.sub.name)}</td><td>${esc(r.role ? r.role.name : r.sub.roleName || "?")}</td><td class="mono">${esc((r.sub.own || []).join(", ") || "none")}</td>
        <td>${r.nRoles} of 5<div class="roles">${D.ROLES.map((x) => `<span class="${r.covered[x.id] ? "on" : ""}" title="${esc(x.name + ": " + (r.covered[x.id] || "missing"))}">${x.id}</span>`).join("")}</div></td>
        <td>${r.right} of 6</td><td><b>${r.ok ? (r.warn.length ? "Complete, check note" : "✓ Complete") : "✗ Not complete"}</b></td><td>${rcCell(r)}</td><td>${vdCell(r)}</td><td>${agCell(r)}</td>
        <td>${r.notes.concat(r.warn).map((n) => `<div>${esc(n)}</div>`).join("") || "None"}</td></tr>`).join("")}</tbody></table>
      <div class="row"><button class="btn" id="tsv">Copy results for a spreadsheet</button><span class="small" id="tsvmsg" role="status"></span></div>
      <p class="small"><b>Reply codes</b> (version 4 and later): every reply the game writes carries a proof code such as R-7KQ, made from the student's own Signal ID and the classmate's, so only codes that match the student are counted. To confirm a reply was really posted, search the Padlet for its code (Ctrl+F) and check it sits under this student's name.</p>
      <p class="small"><b>Verdicts</b> (Trust or Traitor): how many of the agents they judged they got right (Trust for a loyal agent, Traitor for a double agent). <b>As agent</b>: how many classmates trusted a loyal agent, or were fooled by a double agent.</p>
      <div class="row"><button class="btn ghost" id="unbtn" aria-expanded="false">Show the Unmasking</button><span class="small">Reveals who was a double agent. Show it to the class only when everyone is done.</span></div><div id="unmask" hidden>${unmaskHTML(rows, ag)}</div></details>`;
    $("#tsv1").addEventListener("click", () => {
      const tsv = [["Student", "Role", "Done", "Classmates decoded", padPairs ? "Replies found on Padlet" : "Replies posted", "Decoded by", "Notes"].join("\t")].concat(rows.map((r) => [r.sub.name, r.role ? r.role.name : r.sub.roleName, r.ok ? "Done" : "Not done", nDec(r), padCell(r), decodedBy(r), r.notes.concat(r.warn).join(" ")].join("\t"))).join("\n");
      navigator.clipboard.writeText(tsv).then(() => { $("#tsv1msg").textContent = "Copied. Paste into a spreadsheet."; }, () => { $("#tsv1msg").textContent = "Your browser would not copy."; });
    });
    $("#unbtn").addEventListener("click", (e) => { const u = $("#unmask"), open = u.hidden; u.hidden = !open; e.currentTarget.textContent = open ? "Hide the Unmasking" : "Show the Unmasking"; e.currentTarget.setAttribute("aria-expanded", open); if (open) u.scrollIntoView({ block: "start" }); });
    $("#tsv").addEventListener("click", () => {
      const tsv = [["Student", "Role", "Own Signal ID", "Roles covered", "Messages", "Result", "Reply codes", "Verdicts right", "Verdicts filed", "Allegiance", "Trusted by / fooled", "Notes"].join("\t")].concat(rows.map((r) => [r.sub.name, r.role ? r.role.name : r.sub.roleName, (r.sub.own || []).join(" "), r.nRoles + "/5", r.right + "/6", r.ok ? (r.warn.length ? "Complete (check note)" : "Complete") : "Not complete", r.rc.good.map((x) => x.code).join(" "), r.vs.n ? r.vs.right + "/" + r.vs.n : "", r.vs.n, r.agent ? (r.agent.p.alleg ? "Double" : "Loyal") : "", r.agent ? r.agent.pts : "", r.notes.concat(r.warn).join(" ")].join("\t"))).join("\n");
      navigator.clipboard.writeText(tsv).then(() => { $("#tsvmsg").textContent = "Copied. Paste into a spreadsheet."; }, () => { $("#tsvmsg").textContent = "Your browser would not copy."; });
    });
  }

  /* Look up one Signal ID: what that student chose. */
  function look() {
    const p = L.parseSignal($("#one").value), out = $("#oneout");
    if (!p) { out.innerHTML = `<p class="err">That is not a real Signal ID. It looks like XX-ABCABC-K-YY.</p>`; return; }
    out.innerHTML = `<p><b>${esc(p.role.name)}</b> · ${esc(p.ending.title)} · ${esc(p.rank.title)} · score ${p.fs.total}</p><ol>${p.picks.map((x, i) => { const sc = D.SCEN[p.role.id + "-" + i]; return `<li><b>${esc(sc ? sc.title : D.ROUNDS[i].title)}:</b> ${"ABC"[x.slot]}. ${esc(x.label)}</li>`; }).join("")}</ol>`;
  }

  $("#go").addEventListener("click", run);
  $("#pfile").addEventListener("change", async (e) => {
    const f = e.target.files && e.target.files[0]; if (!f) return; padStatus("wait", `Reading ${esc(f.name)}…`);
    try {
      const buf = await f.arrayBuffer(), zip = new Uint8Array(buf, 0, Math.min(2, buf.byteLength)), isZip = zip[0] === 0x50 && zip[1] === 0x4b;
      const text = isZip ? await Promise.race([unzipText(buf), new Promise((res, rej) => setTimeout(() => rej(new Error("timeout")), 15000))]) : new TextDecoder().decode(buf);
      setPadlet(text, f.name);
    } catch (err) { padStatus("bad", `<b>Could not read ${esc(f.name)}.</b> Try Padlet's CSV export instead, or paste text copied from the Padlet below. (${esc(err && err.message || "error")})`); }
    e.target.value = "";
  });
  $("#padgo").addEventListener("click", () => { const t = $("#ptxt").value; if (t.trim()) setPadlet(t, "the pasted text"); });
  $("#padclear").addEventListener("click", () => { padPairs = null; $("#pfile").value = ""; $("#ptxt").value = ""; const m = $("#padmsg"); m.className = "small"; m.textContent = ""; if ($("#out").innerHTML) run(); });
  $("#clear").addEventListener("click", () => { $("#subs").value = ""; $("#out").innerHTML = ""; });
  $("#onego").addEventListener("click", look); $("#one").addEventListener("keydown", (e) => { if (e.key === "Enter") look(); });
})();
