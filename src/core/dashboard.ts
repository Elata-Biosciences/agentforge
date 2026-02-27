import type { RunArtifacts } from './report.js';

export function generateDashboardHtml(artifacts: RunArtifacts, gitCommit?: string | null): string {
  const payload = {
    summary: artifacts.summary,
    config: artifacts.config,
    metrics: artifacts.metrics,
    actions: artifacts.actions,
    evidence: artifacts.evidence ?? null,
    hashes: artifacts.hashes,
    gitCommit: gitCommit ?? null,
  };

  // Embed artifacts as JSON so the HTML is fully self-contained (no CORS/file:// issues).
  const dataJson = safeJson(payload);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AgentForge Dashboard: ${escapeHtml(artifacts.summary.scenarioName)}</title>
  <style>
    :root { --bg:#0b0c10; --fg:#e8e8e8; --muted:#a8a8a8; --card:#12141b; --border:#2a2e3a; --good:#2ecc71; --bad:#ff5c5c; --warn:#f1c40f; }
    @media (prefers-color-scheme: light) { :root { --bg:#ffffff; --fg:#111; --muted:#555; --card:#f6f7fb; --border:#dde2ee; } }
    body { margin:0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; background:var(--bg); color:var(--fg); }
    a { color: inherit; }
    .wrap { max-width: 1200px; margin: 0 auto; padding: 18px; }
    .top { display:flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
    .title { font-size: 20px; font-weight: 650; }
    .pill { font-size: 12px; padding: 2px 8px; border:1px solid var(--border); border-radius: 999px; color:var(--muted); }
    .pill.good { color: var(--good); border-color: color-mix(in oklab, var(--good) 40%, var(--border)); }
    .pill.bad { color: var(--bad); border-color: color-mix(in oklab, var(--bad) 40%, var(--border)); }
    .grid { display:grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 14px; }
    @media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }
    .card { background:var(--card); border:1px solid var(--border); border-radius: 10px; padding: 12px; }
    .card h2 { margin: 0 0 10px 0; font-size: 14px; color: var(--muted); font-weight: 650; letter-spacing: 0.02em; }
    table { width:100%; border-collapse: collapse; }
    th, td { font-size: 12px; border-bottom: 1px solid var(--border); padding: 6px 6px; text-align: left; vertical-align: top; }
    th { color: var(--muted); font-weight: 650; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
    .row { display:flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    input, select { background: transparent; color: var(--fg); border:1px solid var(--border); border-radius: 8px; padding: 6px 8px; font-size: 12px; }
    .small { font-size: 12px; color: var(--muted); }
    .kpi { display:grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .kpi .item { border:1px solid var(--border); border-radius: 10px; padding: 10px; }
    .kpi .k { font-size: 11px; color: var(--muted); }
    .kpi .v { font-size: 16px; margin-top: 2px; font-weight: 650; }
    .svgWrap { overflow-x: auto; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="top">
      <div class="title">AgentForge Dashboard: <span class="mono">${escapeHtml(
        artifacts.summary.scenarioName
      )}</span></div>
      <span id="statusPill" class="pill">status</span>
      <span id="modePill" class="pill">mode</span>
      <span class="pill mono">${escapeHtml(artifacts.summary.runId)}</span>
    </div>
    <div class="small" id="subhead"></div>

    <div class="grid">
      <div class="card">
        <h2>Overview</h2>
        <div class="kpi" id="kpis"></div>
      </div>
      <div class="card">
        <h2>Exploit Evidence</h2>
        <div class="small">Prefer pack-emitted <span class="mono">ExploitEvidence</span> records (post-condition checks). Falls back to simple heuristics if no evidence artifact is present.</div>
        <div style="height:10px"></div>
        <table>
          <thead><tr><th>Tick</th><th>Agent</th><th>Action</th><th>Exploit</th><th>OK</th><th>Gas</th><th>TxHash</th></tr></thead>
          <tbody id="evidenceRows"></tbody>
        </table>
      </div>
    </div>

    <div class="grid">
      <div class="card">
        <h2>Metrics</h2>
        <div class="row">
          <label class="small">Metric</label>
          <select id="metricSelect"></select>
        </div>
        <div style="height:10px"></div>
        <div class="svgWrap" id="metricPlot"></div>
      </div>
      <div class="card">
        <h2>Timeline</h2>
        <div class="row">
          <input id="filterAgent" placeholder="agentId contains..." />
          <input id="filterAction" placeholder="action contains..." />
          <select id="filterOk">
            <option value="any">ok:any</option>
            <option value="ok">ok:true</option>
            <option value="fail">ok:false</option>
          </select>
          <input id="filterText" placeholder="search params/error/txHash..." />
        </div>
        <div style="height:10px"></div>
        <div class="small" id="timelineCount"></div>
        <div style="height:10px"></div>
        <table>
          <thead><tr><th>Tick</th><th>Agent</th><th>Action</th><th>OK</th><th>Info</th></tr></thead>
          <tbody id="timelineRows"></tbody>
        </table>
      </div>
    </div>
  </div>

  <script>
    window.__AF = ${dataJson};

    const data = window.__AF;
    const statusPill = document.getElementById('statusPill');
    const modePill = document.getElementById('modePill');
    const subhead = document.getElementById('subhead');
    const kpis = document.getElementById('kpis');
    const evidenceRows = document.getElementById('evidenceRows');
    const metricSelect = document.getElementById('metricSelect');
    const metricPlot = document.getElementById('metricPlot');
    const timelineRows = document.getElementById('timelineRows');
    const timelineCount = document.getElementById('timelineCount');

    const mode = data.config?.scenario?.mode || 'deterministic';
    const ok = Boolean(data.summary?.success);

    statusPill.textContent = ok ? 'PASSED' : 'FAILED';
    statusPill.classList.add(ok ? 'good' : 'bad');
    modePill.textContent = 'mode:' + mode;
    subhead.textContent = [
      'seed=' + data.summary.seed,
      'ticks=' + data.summary.ticks,
      'durationMs=' + data.summary.durationMs,
      data.gitCommit ? ('git=' + data.gitCommit) : null,
    ].filter(Boolean).join('  •  ');

    const kpiItems = [
      ['runId', data.summary.runId],
      ['pack', data.config?.scenario?.packName || '-'],
      ['agents', String(data.config?.scenario?.agentCount || '-')],
      ['artifactsHash', data.hashes?.actions?.slice(0, 8) || '-'],
    ];
    const finalMetrics = data.summary.finalMetrics || {};
    for (const [k, v] of Object.entries(finalMetrics)) {
      if (kpiItems.length > 12) break;
      kpiItems.push([k, String(v)]);
    }
    kpis.innerHTML = kpiItems.map(([k, v]) => (
      '<div class=\"item\"><div class=\"k\">' + esc(k) + '</div><div class=\"v mono\">' + esc(v) + '</div></div>'
    )).join('');

    // Evidence: prefer evidence.json bundle; fall back to scanning actions; then heuristics.
    const evidence = [];
    if (data.evidence && Array.isArray(data.evidence.records)) {
      data.evidence.records.forEach((r) => {
        evidence.push({
          tick: r.tick,
          agentId: r.agentId,
          actionName: r.actionName || '-',
          exploitId: r.exploitId || '-',
          ok: true,
          gasUsed: '',
          txHash: r.txHash || '',
        });
      });
    }
    if (evidence.length === 0) {
      (data.actions || []).forEach((a) => {
        const events = a.result?.events || [];
        events.forEach((e) => {
          if (e.name !== 'ExploitEvidence') return;
          evidence.push({
            tick: a.tick,
            agentId: a.agentId,
            actionName: a.action?.name || '-',
            exploitId: (e.args && typeof e.args.exploitId === 'string') ? e.args.exploitId : '-',
            ok: a.result?.ok === true,
            gasUsed: a.result?.gasUsed || '',
            txHash: (e.args && typeof e.args.txHash === 'string') ? e.args.txHash : (a.result?.txHash || ''),
          });
        });
      });
    }
    if (evidence.length === 0) {
      (data.actions || []).forEach((a) => {
        const name = a.action?.name || '';
        const txHash = a.result?.txHash;
        if (!txHash) return;
        if (a.result?.ok !== true) return;
        const looksLike = name.startsWith('exploit_') || name.startsWith('oracle_') || name === 'ContractCall' || name === 'arbitrary_tx';
        if (!looksLike) return;
        evidence.push({
          tick: a.tick,
          agentId: a.agentId,
          actionName: name,
          exploitId: '-',
          ok: true,
          gasUsed: a.result?.gasUsed || '',
          txHash: txHash || '',
        });
      });
    }
    evidenceRows.innerHTML = evidence.slice(0, 80).map((e) => {
      return '<tr>' +
        '<td class=\"mono\">' + esc(String(e.tick)) + '</td>' +
        '<td class=\"mono\">' + esc(e.agentId) + '</td>' +
        '<td class=\"mono\">' + esc(e.actionName) + '</td>' +
        '<td class=\"mono\">' + esc(e.exploitId) + '</td>' +
        '<td>' + (e.ok ? 'true' : 'false') + '</td>' +
        '<td class=\"mono\">' + esc(e.gasUsed) + '</td>' +
        '<td class=\"mono\">' + esc(e.txHash) + '</td>' +
      '</tr>';
    }).join('');

    // Metrics selector
    const metricNames = new Set();
    (data.metrics || []).forEach((m) => Object.keys(m).forEach((k) => metricNames.add(k)));
    ['tick', 'timestamp'].forEach((k) => metricNames.delete(k));
    const sortedMetrics = Array.from(metricNames).sort();
    if (sortedMetrics.length === 0) sortedMetrics.push('tick');
    metricSelect.innerHTML = sortedMetrics.map((m) => '<option value=\"' + esc(m) + '\">' + esc(m) + '</option>').join('');
    metricSelect.value = sortedMetrics.includes('exploitsFound') ? 'exploitsFound' : sortedMetrics[0];
    metricSelect.addEventListener('change', () => renderPlot(metricSelect.value));

    function renderPlot(metricName) {
      const samples = data.metrics || [];
      const points = [];
      for (const s of samples) {
        const y = Number(s[metricName]);
        const x = Number(s.tick);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        points.push([x, y]);
      }
      if (points.length < 2) {
        metricPlot.innerHTML = '<div class=\"small\">Not enough numeric samples to plot.</div>';
        return;
      }
      const xs = points.map(p => p[0]);
      const ys = points.map(p => p[1]);
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      const minY = Math.min(...ys), maxY = Math.max(...ys);
      const W = 720, H = 220, pad = 24;
      const sx = (x) => pad + (W - 2*pad) * ((x - minX) / (maxX - minX || 1));
      const sy = (y) => H - pad - (H - 2*pad) * ((y - minY) / (maxY - minY || 1));
      const d = points.map((p, i) => (i === 0 ? 'M' : 'L') + sx(p[0]).toFixed(2) + ',' + sy(p[1]).toFixed(2)).join(' ');
      const svg = '<svg width=\"' + W + '\" height=\"' + H + '\" viewBox=\"0 0 ' + W + ' ' + H + '\">' +
        '<path d=\"' + d + '\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" />' +
        '<text x=\"' + pad + '\" y=\"' + (pad - 8) + '\" font-size=\"12\" fill=\"currentColor\">' + esc(metricName) + '</text>' +
        '<text x=\"' + pad + '\" y=\"' + (H - 6) + '\" font-size=\"11\" fill=\"currentColor\">tick ' + esc(String(minX)) + ' .. ' + esc(String(maxX)) + '</text>' +
        '<text x=\"' + (W - pad - 180) + '\" y=\"' + (H - 6) + '\" font-size=\"11\" fill=\"currentColor\">y ' + esc(String(minY)) + ' .. ' + esc(String(maxY)) + '</text>' +
      '</svg>';
      metricPlot.innerHTML = svg;
    }

    // Timeline filtering
    const filterAgent = document.getElementById('filterAgent');
    const filterAction = document.getElementById('filterAction');
    const filterOk = document.getElementById('filterOk');
    const filterText = document.getElementById('filterText');

    [filterAgent, filterAction, filterOk, filterText].forEach((el) => {
      el.addEventListener('input', renderTimeline);
      el.addEventListener('change', renderTimeline);
    });

    function renderTimeline() {
      const fa = (filterAgent.value || '').toLowerCase();
      const fn = (filterAction.value || '').toLowerCase();
      const ft = (filterText.value || '').toLowerCase();
      const fok = filterOk.value;

      const rows = (data.actions || []).filter((a) => {
        const agentId = (a.agentId || '').toLowerCase();
        const name = (a.action?.name || '').toLowerCase();
        if (fa && !agentId.includes(fa)) return false;
        if (fn && !name.includes(fn)) return false;
        if (fok === 'ok' && a.result?.ok !== true) return false;
        if (fok === 'fail' && a.result?.ok !== false) return false;
        if (ft) {
          const blob = JSON.stringify({ action: a.action, result: a.result })?.toLowerCase?.() || '';
          if (!blob.includes(ft)) return false;
        }
        return true;
      });

      timelineCount.textContent = rows.length + ' actions';
      timelineRows.innerHTML = rows.slice(0, 250).map((a) => {
        const name = a.action?.name || '-';
        const ok = a.result?.ok;
        const info = ok === false ? (a.result?.error || 'error') : (a.result?.txHash ? ('txHash=' + a.result.txHash) : '');
        return '<tr>' +
          '<td class=\"mono\">' + esc(String(a.tick)) + '</td>' +
          '<td class=\"mono\">' + esc(a.agentId) + '</td>' +
          '<td class=\"mono\">' + esc(name) + '</td>' +
          '<td>' + (ok === null || ok === undefined ? '-' : String(ok)) + '</td>' +
          '<td class=\"mono\">' + esc(info) + '</td>' +
        '</tr>';
      }).join('');
    }

    function esc(x) {
      return String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('\"','&quot;');
    }

    renderPlot(metricSelect.value);
    renderTimeline();
  </script>
</body>
</html>`;
}

function safeJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
}

function escapeHtml(input: string): string {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
