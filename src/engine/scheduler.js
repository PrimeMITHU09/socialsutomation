const { listWorkflows } = require('./store');
const { runWorkflow } = require('./executor');

let timer = null;
const lastRunAt = new Map();

function startScheduler(onRun) {
  if (timer) return;
  timer = setInterval(async () => {
    const workflows = listWorkflows();
    const now = Date.now();
    for (const wf of workflows) {
      if (!wf.enabled) continue;
      if (!wf.schedule || !wf.schedule.enabled) continue;
      const everyMinutes = Math.max(Number(wf.schedule.everyMinutes) || 60, 1);
      const last = lastRunAt.get(wf.id) || 0;
      if (now - last < everyMinutes * 60 * 1000) continue;
      lastRunAt.set(wf.id, now);
      try {
        const run = await runWorkflow(wf.id, {
          trigger: 'schedule',
          payload: { scheduledAt: new Date().toISOString() }
        });
        if (typeof onRun === 'function') onRun(run);
      } catch (err) {
        console.error(`[Scheduler] Failed ${wf.id}:`, err.message);
      }
    }
  }, 15000);
  console.log('[Scheduler] Automation schedule loop started (every 15s check).');
}

function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { startScheduler, stopScheduler };
