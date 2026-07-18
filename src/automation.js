/* Prime Automation Engine — frontend editor + runner */
(function () {
  const state = {
    workflows: [],
    catalog: [],
    currentId: null,
    selectedNodeId: null,
    linkingFrom: null,
    linkingPort: 'next',
    dragging: null,
    runs: [],
    dirty: false
  };

  const $ = (id) => document.getElementById(id);

  async function api(path, options = {}) {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  function currentWorkflow() {
    return state.workflows.find((w) => w.id === state.currentId) || null;
  }

  function log(msg, type = 'output-info') {
    if (typeof printToTerminal === 'function') printToTerminal(msg, type);
    if (typeof printToOverviewLogs === 'function') {
      printToOverviewLogs(msg.replace(/^\[[^\]]+\]\s*/, ''), type.includes('success') ? 'success' : type.includes('error') ? 'warning' : 'info');
    }
  }

  function defaultConfig(type) {
    switch (type) {
      case 'delay':
        return { ms: 1000 };
      case 'filter':
        return { field: 'email', operator: 'notEmpty', value: '' };
      case 'condition':
        return { left: '{{score}}', operator: 'gte', right: '0.7' };
      case 'set':
        return { assignments: { message: '{{payload.message || "Hello"}}' } };
      case 'ai.rewrite':
        return { field: 'message', style: 'engaging' };
      case 'http':
        return { url: 'https://httpbin.org/post', method: 'POST', body: {} };
      case 'discord':
        return { webhookUrl: '', content: 'Automation event: {{message || topic || email}}' };
      case 'notion':
        return { token: '', databaseId: '', title: '{{name || "Lead"}}' };
      case 'email':
        return { to: 'team@example.com', subject: 'Automation alert', body: '{{message || email}}', webhookUrl: '' };
      case 'social.facebook':
      case 'social.youtube':
        return { title: '{{message || topic || "Scheduled post"}}' };
      case 'log':
        return { message: 'Checkpoint reached' };
      default:
        return {};
    }
  }

  function metaFor(type) {
    return state.catalog.find((n) => n.type === type) || { label: type, color: '#8e95a5', category: 'Other' };
  }

  async function loadAll() {
    const [nodesRes, wfRes] = await Promise.all([api('/api/nodes'), api('/api/workflows')]);
    state.catalog = nodesRes.nodes || [];
    state.workflows = wfRes.workflows || [];
    if (!state.currentId && state.workflows[0]) state.currentId = state.workflows[0].id;
    renderAll();
  }

  function renderAll() {
    renderWorkflowList();
    renderPalette();
    renderCanvas();
    renderInspector();
    renderSchedule();
    renderWebhook();
    syncNameFields();
    loadRuns();
  }

  function syncNameFields() {
    const wf = currentWorkflow();
    if (!wf) return;
    if ($('aeWorkflowName')) $('aeWorkflowName').value = wf.name || '';
    if ($('aeWorkflowDesc')) $('aeWorkflowDesc').value = wf.description || '';
  }

  function renderWorkflowList() {
    const list = $('aeWorkflowList');
    if (!list) return;
    list.innerHTML = '';
    state.workflows.forEach((wf) => {
      const btn = document.createElement('button');
      btn.className = 'ae-wf-item' + (wf.id === state.currentId ? ' active' : '');
      btn.innerHTML = `<strong>${escapeHtml(wf.name)}</strong><span>${escapeHtml(wf.description || 'Custom workflow')}</span>`;
      btn.onclick = () => {
        state.currentId = wf.id;
        state.selectedNodeId = null;
        state.dirty = false;
        renderAll();
      };
      list.appendChild(btn);
    });
  }

  function renderPalette() {
    const palette = $('aePalette');
    if (!palette) return;
    const groups = {};
    state.catalog.forEach((n) => {
      groups[n.category] = groups[n.category] || [];
      groups[n.category].push(n);
    });
    palette.innerHTML = Object.entries(groups)
      .map(
        ([cat, items]) => `
      <div class="ae-palette-group">
        <div class="ae-palette-title">${escapeHtml(cat)}</div>
        ${items
          .map(
            (n) => `
          <button class="ae-palette-item" data-type="${n.type}" title="Add ${escapeHtml(n.label)}">
            <span class="ae-dot" style="background:${n.color}"></span>
            ${escapeHtml(n.label)}
          </button>`
          )
          .join('')}
      </div>`
      )
      .join('');

    palette.querySelectorAll('.ae-palette-item').forEach((btn) => {
      btn.addEventListener('click', () => addNode(btn.dataset.type));
    });
  }

  function addNode(type) {
    const wf = currentWorkflow();
    if (!wf) return;
    const meta = metaFor(type);
    const id = 'n_' + Date.now().toString(36);
    const node = {
      id,
      type,
      name: meta.label,
      x: 80 + (wf.nodes.length % 5) * 40,
      y: 80 + (wf.nodes.length % 4) * 70,
      config: defaultConfig(type),
      next: null,
      nextTrue: null,
      nextFalse: null
    };
    wf.nodes.push(node);
    state.selectedNodeId = id;
    state.dirty = true;
    renderCanvas();
    renderInspector();
  }

  function renderCanvas() {
    const grid = $('aeNodeGrid');
    const svg = $('aeCanvasSvg');
    const title = $('aeCanvasTitle');
    const wf = currentWorkflow();
    if (!grid || !svg || !wf) return;
    if (title) title.textContent = wf.name + (state.dirty ? ' •' : '');

    grid.innerHTML = '';
    svg.innerHTML = '';

    wf.nodes.forEach((node) => {
      const meta = metaFor(node.type);
      const el = document.createElement('div');
      el.className = 'ae-node' + (state.selectedNodeId === node.id ? ' selected' : '');
      el.style.left = node.x + 'px';
      el.style.top = node.y + 'px';
      el.dataset.id = node.id;
      el.innerHTML = `
        <div class="ae-node-head">
          <span class="ae-dot" style="background:${meta.color}"></span>
          <div>
            <strong>${escapeHtml(node.name || meta.label)}</strong>
            <span>${escapeHtml(node.type)}</span>
          </div>
        </div>
        <div class="ae-node-ports">
          <button class="ae-port in" title="Select node" data-port="select">●</button>
          ${
            node.type === 'condition'
              ? `<button class="ae-port out true" data-port="nextTrue" title="True branch">T</button>
                 <button class="ae-port out false" data-port="nextFalse" title="False branch">F</button>`
              : `<button class="ae-port out" data-port="next" title="Connect next">→</button>`
          }
        </div>
        <button class="ae-node-del" title="Delete node">×</button>
      `;

      el.addEventListener('mousedown', (e) => {
        if (e.target.closest('.ae-port') || e.target.closest('.ae-node-del')) return;
        state.selectedNodeId = node.id;
        state.dragging = {
          id: node.id,
          ox: e.clientX - node.x,
          oy: e.clientY - node.y
        };
        renderCanvas();
        renderInspector();
      });

      el.querySelector('.ae-node-del').onclick = (e) => {
        e.stopPropagation();
        deleteNode(node.id);
      };

      el.querySelectorAll('.ae-port').forEach((port) => {
        port.addEventListener('click', (e) => {
          e.stopPropagation();
          const portName = port.dataset.port;
          if (portName === 'select') {
            state.selectedNodeId = node.id;
            renderCanvas();
            renderInspector();
            return;
          }
          if (!state.linkingFrom) {
            state.linkingFrom = node.id;
            state.linkingPort = portName;
            log(`[Engine] Linking from ${node.name} (${portName}) — click target node`, 'output-info');
            return;
          }
          // complete link onto this node
          completeLink(node.id);
        });
      });

      // Drop link target by clicking body while linking
      el.addEventListener('click', (e) => {
        if (state.linkingFrom && state.linkingFrom !== node.id && !e.target.closest('.ae-port')) {
          completeLink(node.id);
        }
      });

      grid.appendChild(el);
    });

    drawLinks(wf, svg);
  }

  function completeLink(targetId) {
    const wf = currentWorkflow();
    if (!wf || !state.linkingFrom) return;
    const from = wf.nodes.find((n) => n.id === state.linkingFrom);
    if (!from || from.id === targetId) {
      state.linkingFrom = null;
      return;
    }
    from[state.linkingPort || 'next'] = targetId;
    state.linkingFrom = null;
    state.dirty = true;
    renderCanvas();
    renderInspector();
  }

  function deleteNode(nodeId) {
    const wf = currentWorkflow();
    if (!wf) return;
    wf.nodes = wf.nodes.filter((n) => n.id !== nodeId);
    wf.nodes.forEach((n) => {
      if (n.next === nodeId) n.next = null;
      if (n.nextTrue === nodeId) n.nextTrue = null;
      if (n.nextFalse === nodeId) n.nextFalse = null;
    });
    if (state.selectedNodeId === nodeId) state.selectedNodeId = null;
    state.dirty = true;
    renderCanvas();
    renderInspector();
  }

  function drawLinks(wf, svg) {
    const nodeEls = {};
    wf.nodes.forEach((n) => {
      const el = document.querySelector(`.ae-node[data-id="${n.id}"]`);
      if (el) nodeEls[n.id] = el;
    });
    const canvas = $('aeCanvasInner');
    if (!canvas) return;
    const canvasRect = canvas.getBoundingClientRect();

    const point = (el, side) => {
      const r = el.getBoundingClientRect();
      return {
        x: r.left - canvasRect.left + (side === 'right' ? r.width : 0),
        y: r.top - canvasRect.top + r.height / 2
      };
    };

    const draw = (fromId, toId, color) => {
      const a = nodeEls[fromId];
      const b = nodeEls[toId];
      if (!a || !b) return;
      const p1 = point(a, 'right');
      const p2 = point(b, 'left');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const mid = (p1.x + p2.x) / 2;
      path.setAttribute('d', `M ${p1.x} ${p1.y} C ${mid} ${p1.y}, ${mid} ${p2.y}, ${p2.x} ${p2.y}`);
      path.setAttribute('stroke', color);
      path.setAttribute('stroke-width', '2.5');
      path.setAttribute('fill', 'none');
      path.setAttribute('opacity', '0.85');
      svg.appendChild(path);
    };

    wf.nodes.forEach((n) => {
      if (n.next) draw(n.id, n.next, 'rgba(139,92,246,0.7)');
      if (n.nextTrue) draw(n.id, n.nextTrue, 'rgba(16,185,129,0.8)');
      if (n.nextFalse) draw(n.id, n.nextFalse, 'rgba(239,68,68,0.75)');
    });
  }

  function renderInspector() {
    const panel = $('aeInspector');
    if (!panel) return;
    const wf = currentWorkflow();
    const node = wf && wf.nodes.find((n) => n.id === state.selectedNodeId);
    if (!node) {
      panel.innerHTML = `<div class="ae-empty">Select a node to edit its settings. Drag nodes to rearrange. Use → / T / F ports to connect.</div>`;
      return;
    }

    const meta = metaFor(node.type);
    let fields = '';

    if (node.type === 'delay') {
      fields = fieldInput('ms', 'Delay (ms)', node.config.ms || 1000);
    } else if (node.type === 'filter') {
      fields =
        fieldInput('field', 'Field', node.config.field || 'email') +
        fieldSelect('operator', 'Operator', node.config.operator || 'notEmpty', opOptions()) +
        fieldInput('value', 'Value', node.config.value || '');
    } else if (node.type === 'condition') {
      fields =
        fieldInput('left', 'Left (supports {{vars}})', node.config.left || '') +
        fieldSelect('operator', 'Operator', node.config.operator || 'gte', opOptions()) +
        fieldInput('right', 'Right', node.config.right || '');
    } else if (node.type === 'set') {
      fields = fieldTextarea('assignments', 'Assignments JSON', JSON.stringify(node.config.assignments || {}, null, 2));
    } else if (node.type === 'ai.rewrite') {
      fields =
        fieldInput('field', 'Field', node.config.field || 'message') +
        fieldSelect('style', 'Style', node.config.style || 'engaging', [
          ['engaging', 'Engaging'],
          ['youtube', 'YouTube'],
          ['formal', 'Formal']
        ]);
    } else if (node.type === 'http') {
      fields =
        fieldInput('url', 'URL', node.config.url || '') +
        fieldSelect('method', 'Method', node.config.method || 'POST', [
          ['GET', 'GET'],
          ['POST', 'POST'],
          ['PUT', 'PUT']
        ]) +
        fieldTextarea('body', 'JSON Body', JSON.stringify(node.config.body || {}, null, 2));
    } else if (node.type === 'discord') {
      fields =
        fieldInput('webhookUrl', 'Discord Webhook URL', node.config.webhookUrl || '') +
        fieldTextarea('content', 'Message', node.config.content || '');
    } else if (node.type === 'notion') {
      fields =
        fieldInput('token', 'Notion Token', node.config.token || '') +
        fieldInput('databaseId', 'Database ID', node.config.databaseId || '') +
        fieldInput('title', 'Title', node.config.title || '');
    } else if (node.type === 'email') {
      fields =
        fieldInput('to', 'To', node.config.to || '') +
        fieldInput('subject', 'Subject', node.config.subject || '') +
        fieldTextarea('body', 'Body', node.config.body || '') +
        fieldInput('webhookUrl', 'Optional forward webhook', node.config.webhookUrl || '');
    } else if (node.type === 'social.facebook' || node.type === 'social.youtube') {
      fields = fieldInput('title', 'Post / Title', node.config.title || '');
    } else if (node.type === 'log') {
      fields = fieldInput('message', 'Message', node.config.message || '');
    } else {
      fields = `<p class="ae-hint">Trigger node — starts the workflow (manual, webhook, or schedule).</p>`;
    }

    panel.innerHTML = `
      <div class="ae-insp-head">
        <span class="ae-dot" style="background:${meta.color}"></span>
        <div>
          <strong>${escapeHtml(meta.label)}</strong>
          <span>${escapeHtml(node.type)}</span>
        </div>
      </div>
      ${fieldInput('_name', 'Node Name', node.name || meta.label)}
      ${fields}
      <div class="ae-link-meta">
        <small>next: ${node.next || '—'} ${node.type === 'condition' ? `| T: ${node.nextTrue || '—'} | F: ${node.nextFalse || '—'}` : ''}</small>
      </div>
    `;

    panel.querySelectorAll('[data-key]').forEach((input) => {
      input.addEventListener('change', () => applyField(node, input));
      input.addEventListener('input', () => applyField(node, input));
    });
  }

  function applyField(node, input) {
    const key = input.dataset.key;
    let val = input.value;
    if (key === '_name') {
      node.name = val;
      state.dirty = true;
      renderCanvas();
      return;
    }
    if (key === 'assignments' || key === 'body') {
      try {
        val = JSON.parse(val);
      } catch {
        return;
      }
    }
    if (key === 'ms') val = Number(val) || 0;
    node.config = node.config || {};
    node.config[key] = val;
    state.dirty = true;
  }

  function fieldInput(key, label, value) {
    return `<label class="ae-field"><span>${escapeHtml(label)}</span><input data-key="${key}" value="${escapeAttr(value)}" /></label>`;
  }
  function fieldTextarea(key, label, value) {
    return `<label class="ae-field"><span>${escapeHtml(label)}</span><textarea data-key="${key}" rows="4">${escapeHtml(value)}</textarea></label>`;
  }
  function fieldSelect(key, label, value, options) {
    return `<label class="ae-field"><span>${escapeHtml(label)}</span><select data-key="${key}">${options
      .map(([v, l]) => `<option value="${escapeAttr(v)}" ${v === value ? 'selected' : ''}>${escapeHtml(l)}</option>`)
      .join('')}</select></label>`;
  }
  function opOptions() {
    return [
      ['eq', equalsLabel()],
      ['neq', 'Not equal'],
      ['gt', 'Greater than'],
      ['gte', 'Greater or equal'],
      ['lt', 'Less than'],
      ['lte', 'Less or equal'],
      ['contains', 'Contains'],
      ['empty', 'Is empty'],
      ['notEmpty', 'Not empty']
    ];
  }
  function equalsLabel() {
    return 'Equals';
  }

  function renderSchedule() {
    const wf = currentWorkflow();
    const enabled = $('aeScheduleEnabled');
    const mins = $('aeScheduleMinutes');
    if (!wf || !enabled || !mins) return;
    enabled.checked = !!(wf.schedule && wf.schedule.enabled);
    mins.value = (wf.schedule && wf.schedule.everyMinutes) || 60;
  }

  function renderWebhook() {
    const el = $('aeWebhookUrl');
    const wf = currentWorkflow();
    if (!el || !wf) return;
    el.value = `${window.location.origin}/api/hooks/${wf.id}`;
  }

  async function loadRuns() {
    const box = $('aeRunHistory');
    const wf = currentWorkflow();
    if (!box || !wf) return;
    try {
      const data = await api(`/api/workflows/${wf.id}/runs`);
      state.runs = data.runs || [];
      box.innerHTML =
        state.runs.length === 0
          ? `<div class="ae-empty">No runs yet. Execute the workflow to see history.</div>`
          : state.runs
              .map(
                (r) => `
        <button class="ae-run-item ${r.status}" data-id="${r.id}">
          <strong>${escapeHtml(r.status)}</strong>
          <span>${escapeHtml(r.trigger)} · ${new Date(r.startedAt).toLocaleString()}</span>
        </button>`
              )
              .join('');
      box.querySelectorAll('.ae-run-item').forEach((btn) => {
        btn.onclick = () => showRun(btn.dataset.id);
      });
    } catch (err) {
      box.innerHTML = `<div class="ae-empty">History unavailable: ${escapeHtml(err.message)}</div>`;
    }
  }

  async function showRun(runId) {
    try {
      const { run } = await api(`/api/runs/${runId}`);
      highlightRun(run);
      log(`[Engine] Run ${run.id}: ${run.status} (${run.steps.length} steps)`, run.status === 'success' ? 'output-success' : 'output-error');
      (run.logs || []).forEach((l) => log(`[Run] ${l.message}`, 'output-info'));
      (run.steps || []).forEach((s) => {
        log(`[Step] ${s.name || s.type}: ${s.ok ? 'OK' : s.error || 'fail'} (${s.ms}ms)`, s.ok ? 'output-success' : 'output-error');
      });
    } catch (err) {
      log(`[Engine] ${err.message}`, 'output-error');
    }
  }

  function highlightRun(run) {
    document.querySelectorAll('.ae-node').forEach((el) => el.classList.remove('running', 'ok', 'fail'));
    (run.steps || []).forEach((step, i) => {
      const el = document.querySelector(`.ae-node[data-id="${step.nodeId}"]`);
      if (!el) return;
      setTimeout(() => {
        el.classList.add(step.ok ? 'ok' : 'fail');
      }, i * 180);
    });
  }

  async function saveWorkflow() {
    const wf = currentWorkflow();
    if (!wf) return;
    wf.schedule = {
      enabled: !!($('aeScheduleEnabled') && $('aeScheduleEnabled').checked),
      everyMinutes: Number(($('aeScheduleMinutes') && $('aeScheduleMinutes').value) || 60)
    };
    wf.name = ($('aeWorkflowName') && $('aeWorkflowName').value.trim()) || wf.name;
    wf.description = ($('aeWorkflowDesc') && $('aeWorkflowDesc').value.trim()) || wf.description;
    const { workflow } = await api(`/api/workflows/${wf.id}`, { method: 'PUT', body: JSON.stringify(wf) });
    const idx = state.workflows.findIndex((w) => w.id === wf.id);
    if (idx >= 0) state.workflows[idx] = workflow;
    state.dirty = false;
    log(`[Engine] Saved workflow: ${workflow.name}`, 'output-success');
    renderAll();
  }

  async function runCurrent(payload = {}) {
    const wf = currentWorkflow();
    if (!wf) return;
    if (state.dirty) await saveWorkflow();
    const btn = $('btnRunWorkflow');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<div class="spinner-neon" style="width:14px;height:14px;border-width:2px;margin-right:6px;"></div> Running...';
    }
    try {
      log(`[Engine] Executing: ${wf.name}`, 'output-info');
      const { run } = await api(`/api/workflows/${wf.id}/run`, {
        method: 'POST',
        body: JSON.stringify({ trigger: 'manual', payload })
      });
      highlightRun(run);
      log(`[Engine] Completed: ${run.status}`, run.status === 'success' ? 'output-success' : 'output-error');
      (run.logs || []).slice(-5).forEach((l) => log(`[Run] ${l.message}`, 'output-info'));
      if (typeof window.syncSocialQueueFromServer === 'function') {
        window.syncSocialQueueFromServer();
      }
      loadRuns();
      if (typeof mediaCount !== 'undefined' && $('overviewMediaCount')) {
        mediaCount += 1;
        overviewMediaCount.textContent = mediaCount;
      }
      return run;
    } catch (err) {
      log(`[Engine] ${err.message}`, 'output-error');
      throw err;
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg> Execute Workflow`;
      }
    }
  }

  async function createWorkflow() {
    const name = prompt('New workflow name:', 'My Workflow');
    if (!name) return;
    const { workflow } = await api('/api/workflows', {
      method: 'POST',
      body: JSON.stringify({ name, description: 'Custom automation' })
    });
    state.workflows.push(workflow);
    state.currentId = workflow.id;
    state.selectedNodeId = workflow.nodes[0] && workflow.nodes[0].id;
    renderAll();
    log(`[Engine] Created workflow: ${workflow.name}`, 'output-success');
  }

  async function deleteCurrentWorkflow() {
    const wf = currentWorkflow();
    if (!wf) return;
    if (!confirm(`Delete workflow "${wf.name}"?`)) return;
    await api(`/api/workflows/${wf.id}`, { method: 'DELETE' });
    state.workflows = state.workflows.filter((w) => w.id !== wf.id);
    state.currentId = state.workflows[0] ? state.workflows[0].id : null;
    renderAll();
    log(`[Engine] Deleted workflow`, 'output-info');
  }

  function bindUi() {
    const runBtn = $('btnRunWorkflow');
    if (runBtn) runBtn.addEventListener('click', () => runCurrent());

    const saveBtn = $('aeSaveBtn');
    if (saveBtn) saveBtn.addEventListener('click', () => saveWorkflow().catch((e) => log(e.message, 'output-error')));

    const newBtn = $('aeNewBtn');
    if (newBtn) newBtn.addEventListener('click', () => createWorkflow().catch((e) => log(e.message, 'output-error')));

    const delBtn = $('aeDeleteBtn');
    if (delBtn) delBtn.addEventListener('click', () => deleteCurrentWorkflow().catch((e) => log(e.message, 'output-error')));

    const copyBtn = $('aeCopyWebhook');
    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        const el = $('aeWebhookUrl');
        if (!el) return;
        try {
          await navigator.clipboard.writeText(el.value);
          log('[Engine] Webhook URL copied', 'output-success');
        } catch {
          el.select();
          log('[Engine] Select webhook URL and copy manually', 'output-info');
        }
      });
    }

    const enabled = $('aeScheduleEnabled');
    const mins = $('aeScheduleMinutes');
    if (enabled) {
      enabled.addEventListener('change', () => {
        const wf = currentWorkflow();
        if (!wf) return;
        wf.schedule = wf.schedule || {};
        wf.schedule.enabled = enabled.checked;
        state.dirty = true;
      });
    }
    if (mins) {
      mins.addEventListener('change', () => {
        const wf = currentWorkflow();
        if (!wf) return;
        wf.schedule = wf.schedule || {};
        wf.schedule.everyMinutes = Number(mins.value) || 60;
        state.dirty = true;
      });
    }

    const nameInput = $('aeWorkflowName');
    const descInput = $('aeWorkflowDesc');
    if (nameInput) {
      nameInput.addEventListener('input', () => {
        const wf = currentWorkflow();
        if (!wf) return;
        wf.name = nameInput.value;
        state.dirty = true;
      });
    }
    if (descInput) {
      descInput.addEventListener('input', () => {
        const wf = currentWorkflow();
        if (!wf) return;
        wf.description = descInput.value;
        state.dirty = true;
      });
    }

    document.addEventListener('mousemove', (e) => {
      if (!state.dragging) return;
      const wf = currentWorkflow();
      const node = wf && wf.nodes.find((n) => n.id === state.dragging.id);
      if (!node) return;
      node.x = Math.max(0, e.clientX - state.dragging.ox);
      node.y = Math.max(0, e.clientY - state.dragging.oy);
      state.dirty = true;
      const el = document.querySelector(`.ae-node[data-id="${node.id}"]`);
      if (el) {
        el.style.left = node.x + 'px';
        el.style.top = node.y + 'px';
      }
      const svg = $('aeCanvasSvg');
      if (svg && wf) {
        svg.innerHTML = '';
        drawLinks(wf, svg);
      }
    });

    document.addEventListener('mouseup', () => {
      state.dragging = null;
    });

    window.addEventListener('resize', () => {
      const wf = currentWorkflow();
      const svg = $('aeCanvasSvg');
      if (wf && svg) {
        svg.innerHTML = '';
        drawLinks(wf, svg);
      }
    });
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function escapeAttr(str) {
    return escapeHtml(str).replace(/'/g, '&#39;');
  }

  window.AutomationEngineUI = {
    init: async function () {
      bindUi();
      try {
        await loadAll();
        log('[Engine] Automation engine ready', 'output-success');
      } catch (err) {
        log(`[Engine] Failed to load: ${err.message}. Is the server running?`, 'output-error');
      }
    },
    run: runCurrent,
    selectWorkflow: function (id) {
      state.currentId = id;
      renderAll();
    },
    getWorkflows: () => state.workflows
  };
})();
