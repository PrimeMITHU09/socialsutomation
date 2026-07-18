const { getWorkflow, saveRun, uid } = require('./store');
const { executeNode } = require('./nodes');

async function runWorkflow(workflowId, { trigger = 'manual', payload = {} } = {}) {
  const workflow = typeof workflowId === 'object' ? workflowId : getWorkflow(workflowId);
  if (!workflow) {
    throw new Error('Workflow not found');
  }

  const nodeMap = Object.fromEntries((workflow.nodes || []).map((n) => [n.id, n]));
  const start =
    (workflow.nodes || []).find((n) => String(n.type).startsWith('trigger.')) ||
    (workflow.nodes || [])[0];

  const run = {
    id: uid('run'),
    workflowId: workflow.id,
    workflowName: workflow.name,
    trigger,
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    payload,
    steps: [],
    logs: []
  };

  const ctx = {
    payload,
    trigger,
    workflowId: workflow.id,
    ...payload
  };

  const helpers = {
    log: (message) => {
      run.logs.push({ at: new Date().toISOString(), message: String(message) });
    },
    emitSocial: (item) => {
      run.logs.push({ at: new Date().toISOString(), message: `Social queued (${item.type}): ${item.title}` });
    }
  };

  let currentId = start ? start.id : null;
  let guard = 0;

  while (currentId && guard < 100) {
    guard += 1;
    const node = nodeMap[currentId];
    if (!node) {
      run.steps.push({ nodeId: currentId, error: 'Node missing', ok: false });
      run.status = 'failed';
      break;
    }

    const stepStart = Date.now();
    try {
      const result = await executeNode(node, ctx, helpers);
      run.steps.push({
        nodeId: node.id,
        name: node.name,
        type: node.type,
        ok: !!result.ok,
        output: result.output || null,
        error: result.error || null,
        ms: Date.now() - stepStart
      });

      if (!result.ok) {
        run.status = 'failed';
        run.error = result.error || `Node ${node.name} failed`;
        break;
      }

      if (result.stopped) {
        run.status = 'success';
        run.logs.push({ at: new Date().toISOString(), message: `Stopped by filter at ${node.name}` });
        break;
      }

      currentId = result.next || null;
      if (!currentId) {
        run.status = 'success';
      }
    } catch (err) {
      run.steps.push({
        nodeId: node.id,
        name: node.name,
        type: node.type,
        ok: false,
        error: err.message,
        ms: Date.now() - stepStart
      });
      run.status = 'failed';
      run.error = err.message;
      break;
    }
  }

  if (run.status === 'running') run.status = 'success';
  run.finishedAt = new Date().toISOString();
  run.context = {
    message: ctx.message,
    topic: ctx.topic,
    email: ctx.email,
    score: ctx.score,
    rewritten: ctx.rewritten
  };
  saveRun(run);
  return run;
}

module.exports = { runWorkflow };
