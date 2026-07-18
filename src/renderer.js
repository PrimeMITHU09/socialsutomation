// Determine execution environment
const isElectron = typeof window.electronAPI !== 'undefined';

// Remove no-js class immediately (enables JS-dependent styles)
document.documentElement.classList.remove('no-js');

let userProfile = null;
let flowsExecutedCount = 0;
let aiConversationsCount = 0;
let authLanguage = localStorage.getItem('auth_language') || 'en';
let _settingsDirty = false;
let _savedCredKeys = new Set();

// State Management
let projectsList = [];
let localDownloadDir = '';
const browserDownloadStates = new Map();
let mediaCount = 42;

// Elements
const projectGrid = document.getElementById('projectGrid');
const downloadPathText = document.getElementById('downloadPathText');
const downloadPathIndicator = document.getElementById('downloadPathIndicator');
const terminalDock = document.getElementById('terminalDock');
const terminalHeader = document.getElementById('terminalHeader');
const terminalInput = document.getElementById('terminalInput');
const terminalOutput = document.getElementById('terminalOutput');
const overviewMediaCount = document.getElementById('overviewMediaCount');
const overviewLogs = document.getElementById('overviewLogs');

// Auth & Profile Elements
const profileOverlay = document.getElementById('profileOverlay');
const profileCloseBtn = document.getElementById('profileCloseBtn');
const openProfileBtn = document.getElementById('openProfileBtn');
const authOverlay = document.getElementById('authOverlay');
const authCloseBtn = document.getElementById('authCloseBtn');
const openAuthBtn = document.getElementById('openAuthBtn');
const logoutBtn = document.getElementById('logoutBtn');
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const tabLogin = document.getElementById('tabLogin');
const tabRegister = document.getElementById('tabRegister');

// Autopilot Elements
const statusFb = document.getElementById('statusFb');
const btnConnectFb = document.getElementById('btnConnectFb');
const statusYt = document.getElementById('statusYt');
const btnConnectYt = document.getElementById('btnConnectYt');
const autopilotQueueList = document.getElementById('autopilotQueueList');
const queueEmptyState = document.getElementById('queueEmptyState');
const chkAutoPublish = document.getElementById('chkAutoPublish');
const chkAutoGenerate = document.getElementById('chkAutoGenerate');
const chkAutoHashtag = document.getElementById('chkAutoHashtag');
const btnQueueStoryboard = document.getElementById('btnQueueStoryboard');

// ----------------------------------------------------
// UI Navigation Tab Switching
// ----------------------------------------------------
const navItems = document.querySelectorAll('.nav-item');
const viewSections = document.querySelectorAll('.viewport-section');
const sidebarEl = document.querySelector('.sidebar');
const mobileMenuBtn = document.getElementById('mobileMenuBtn');

function closeMobileSidebar() {
  if (!sidebarEl) return;
  sidebarEl.classList.remove('sidebar-open');
}

function openMobileSidebar() {
  if (!sidebarEl) return;
  sidebarEl.classList.add('sidebar-open');
}

function updateSidebarMode() {
  if (!sidebarEl || !mobileMenuBtn) return;
  sidebarEl.classList.remove('mobile-mini', 'mobile-hide', 'sidebar-open');
  mobileMenuBtn.classList.remove('sidebar-open');

  if (window.innerWidth <= 640) {
    sidebarEl.classList.add('mobile-hide');
  } else if (window.innerWidth <= 1024) {
    sidebarEl.classList.add('mobile-mini');
  }
}

navItems.forEach(item => {
  item.addEventListener('click', () => {
    // Remove active from all nav items
    navItems.forEach(n => n.classList.remove('active'));
    // Add active to current
    item.classList.add('active');
    
    // Hide all view sections
    viewSections.forEach(section => section.classList.remove('active'));
    // Show target section
    const targetId = item.getAttribute('data-target');
    const targetSection = document.getElementById(targetId);
    if (targetSection) {
      targetSection.classList.add('active');
      printToTerminal(`[Workspace] Navigated to: ${item.textContent.trim()}`, 'output-info');
    }
    
    // Custom triggers on tab load
    if (targetId === 'automation-view') {
      // Re-draw SVG connections after element is rendered
      setTimeout(drawNodeConnections, 100);
    }

    if (targetId === 'overview-view') {
      setTimeout(refreshOverviewStats, 50);
    }

    if (targetId === 'admin-view') {
      setTimeout(loadAdminStats, 50);
    }

    if (window.innerWidth <= 1024) {
      closeMobileSidebar();
    }
  });
});

if (mobileMenuBtn) {
  mobileMenuBtn.addEventListener('click', () => {
    if (!sidebarEl) return;
    sidebarEl.classList.toggle('sidebar-open');
    mobileMenuBtn.classList.toggle('sidebar-open');
  });
}

window.addEventListener('resize', updateSidebarMode);
updateSidebarMode();

// ----------------------------------------------------
// UI Initialization
// ----------------------------------------------------
async function initializeApp() {
  // Load Projects and Paths for Classic Templates
  if (isElectron) {
    projectsList = await window.electronAPI.getProjects();
    localDownloadDir = await window.electronAPI.getDownloadDir();
    window.electronAPI.onDownloadProgress((data) => {
      handleDownloadProgress(data);
    });
  } else {
    console.warn('Running in browser mode without Electron desktop integrations. Some local desktop actions may be unavailable.');
    projectsList = window.projectsData || [];
    localDownloadDir = '/home/downloads/PrimeDashboard';

    projectsList = projectsList.map(proj => {
      const isDownloaded = localStorage.getItem(`dl_${proj.id}`) === 'true';
      return {
        ...proj,
        downloaded: isDownloaded,
        localPath: `${localDownloadDir}/${proj.id}.zip`
      };
    });
  }

  if (downloadPathText) downloadPathText.textContent = localDownloadDir;
  refreshOverviewStats();

  if (terminalHeader) {
    terminalHeader.addEventListener('click', (e) => {
      if (e.target.tagName !== 'BUTTON') {
        toggleTerminal();
      }
    });
  }

  if (downloadPathIndicator) {
    downloadPathIndicator.addEventListener('click', () => {
      if (isElectron) {
        window.electronAPI.openProjectFolder('');
      } else {
        printToTerminal(`[System] Desktop folder opening is unavailable in browser mode. Expected local path: ${localDownloadDir}`, 'output-warning');
      }
    });
  }

  if (terminalInput) {
    terminalInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const command = terminalInput.value.trim();
        if (command) {
          processCommand(command);
          terminalInput.value = '';
        }
      }
    });
  }

  await initializeAuthAndProfile();

  const initSteps = [
    ['Automation Engine', initializeAutomationEngine],
    ['Video Storyboard', initializeGenerativeStudio],
    ['Fundamentals Hub', initializeFundamentalsHub],
    ['AI Tools', initializeAiTools],
    ['Social Autopilot', initializeSocialAutopilot],
    ['Video Tools', initVideoWatermarkRemover]
  ];

  for (const [label, initFn] of initSteps) {
    try {
      await initFn();
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      console.error(`[Init] ${label} failed:`, err);
      printToTerminal(`[Init] ${label} failed: ${message}`, 'output-error');
      printToOverviewLogs(`${label} failed during startup`, 'error');
    }
  }

  if (terminalInput) terminalInput.focus();
}

// ----------------------------------------------------
// System Console Logger Helper
// ----------------------------------------------------
function printToTerminal(text, type = '') {
  if (!terminalOutput) return;
  const line = document.createElement('div');
  line.className = `terminal-line ${type}`;
  line.textContent = text;
  terminalOutput.appendChild(line);
  terminalOutput.scrollTop = terminalOutput.scrollHeight;
}

function printToOverviewLogs(text, type = 'info') {
  if (!overviewLogs) return;
  const logRow = document.createElement('div');
  logRow.className = `log-row ${type}`;
  const timestamp = new Date().toTimeString().split(' ')[0];
  logRow.textContent = `[${timestamp}] ${text}`;
  overviewLogs.prepend(logRow); // Add to top
}

// ----------------------------------------------------
// 1. AUTOMATION WORKSPACE (backed by real engine API)
// ----------------------------------------------------
function initializeAutomationEngine() {
  if (window.AutomationEngineUI && typeof window.AutomationEngineUI.init === 'function') {
    window.AutomationEngineUI.init();
  } else {
    printToTerminal('[Engine] automation.js not loaded', 'output-error');
  }
}

async function runWorkflowSimulation() {
  if (window.AutomationEngineUI && typeof window.AutomationEngineUI.run === 'function') {
    return window.AutomationEngineUI.run();
  }
}

// ----------------------------------------------------
// 2. GENERATIVE STUDIO LOGIC
// ----------------------------------------------------
function initializeGenerativeStudio() {
  const btnGenerateScript = document.getElementById('btnGenerateScript');
  const viewerBlank = document.getElementById('viewerBlankState');
  const viewerLoader = document.getElementById('viewerLoader');
  const viewerStoryboard = document.getElementById('viewerStoryboardResult');

  // Generate Video Storyboard (AI-powered)
  btnGenerateScript.addEventListener('click', async () => {
    const topic = document.getElementById('videoTopic').value.trim();
    const videoMode = document.getElementById('videoType').value;
    const audience = document.getElementById('videoAudience') ? document.getElementById('videoAudience').value : 'freelancers';
    const voice = document.getElementById('videoVoice') ? document.getElementById('videoVoice').value : 'energetic';

    if (!topic) {
      alert('Please enter a channel niche/topic!');
      return;
    }

    printToTerminal(`[Generative Studio] Composing ${videoMode} video storyboard: "${topic}"`, 'output-info');

    viewerBlank.classList.add('hidden');
    viewerStoryboard.classList.add('hidden');
    viewerLoader.classList.remove('hidden');

    const loaderText = document.getElementById('viewerLoaderText');
    const loaderPercent = document.getElementById('viewerLoaderPercent');
    const loaderBar = document.getElementById('viewerLoaderBar');

    const stages = [
      { text: `Audience targeting for ${videoMode} mode...`, pct: 20 },
      { text: "Structuring video hook script...", pct: 45 },
      { text: "AI writing storyboard scene voiceovers...", pct: 70 },
      { text: "Generating visual prompt mappings...", pct: 90 },
      { text: "Finalizing storyboard layout...", pct: 100 }
    ];

    for (let i = 0; i < stages.length; i++) {
      loaderText.textContent = stages[i].text;
      let startPct = i === 0 ? 0 : stages[i - 1].pct;
      let targetPct = stages[i].pct;

      for (let p = startPct; p <= targetPct; p += 8) {
        loaderPercent.textContent = `${p}%`;
        loaderBar.style.width = `${p}%`;
        await new Promise(r => setTimeout(r, 100));
      }
    }

    try {
      const res = await fetch('/api/generate/storyboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, videoMode, audience, voice })
      });

      const data = await res.json();

      if (data.error) {
        throw new Error(data.error);
      }

      const storyboardScenes = data.scenes || [];

      if (storyboardScenes.length === 0) {
        throw new Error('AI returned empty storyboard');
      }

      // Render storyboard
      const listContainer = document.getElementById('storyboardList');
      listContainer.innerHTML = '';

      document.getElementById('storyboardTitle').textContent = `Storyboard (${videoMode.toUpperCase()}): ${topic}`;

      storyboardScenes.forEach(scene => {
        const card = document.createElement('div');
        card.className = 'storyboard-card';
        card.innerHTML = `
          <div class="scene-num">${scene.num || storyboardScenes.indexOf(scene) + 1}</div>
          <div class="scene-content">
            <h5>${scene.title || 'Scene ' + (storyboardScenes.indexOf(scene) + 1)}</h5>
            <p style="color: var(--secondary); font-size: 0.72rem; font-style: italic; margin-bottom: 4px;"><strong>Direction:</strong> ${scene.direction || 'No direction specified'}</p>
            <p><strong>Voiceover:</strong> "${scene.script || 'No script'}"</p>
            <div class="scene-asset-prompt"><strong>Visual Prompt:</strong> ${scene.prompt || 'No prompt'}</div>
          </div>
        `;
        listContainer.appendChild(card);
      });

      viewerLoader.classList.add('hidden');
      viewerStoryboard.classList.remove('hidden');

      printToTerminal(`[Generative Studio] AI storyboard composed: ${storyboardScenes.length} scenes (${videoMode} mode).`, 'output-success');
      printToOverviewLogs(`AI video storyboard created (${videoMode}): "${topic}"`, 'success');

      mediaCount += 1;
      overviewMediaCount.textContent = mediaCount;

    } catch (err) {
      viewerLoader.classList.add('hidden');
      viewerStoryboard.classList.remove('hidden');

      const listContainer = document.getElementById('storyboardList');
      listContainer.innerHTML = '';

      document.getElementById('storyboardTitle').textContent = `Storyboard Error`;

      const errorCard = document.createElement('div');
      errorCard.className = 'storyboard-card';
      errorCard.innerHTML = `
        <div class="scene-content">
          <h5 style="color: #ff6b6b;">Generation Failed</h5>
          <p>${err.message || 'Unknown error occurred.'}</p>
          <p style="color: var(--secondary); font-size: 0.72rem; margin-top: 8px;">Make sure your Gemini API key is set in Settings > API Credentials.</p>
        </div>
      `;
      listContainer.appendChild(errorCard);

      printToTerminal(`[Generative Studio] Storyboard generation failed: ${err.message}`, 'output-error');
      printToOverviewLogs(`Storyboard generation failed: ${err.message}`, 'error');
    }
  });
}

// ----------------------------------------------------
// 3. AGENTIC WORKSPACE LOGIC
// ----------------------------------------------------
// Agent workspace removed — was demo/fake
let currentAgent = "support";

// Agent workspace functions removed — was demo/fake

// ----------------------------------------------------
// 4. FUNDAMENTALS & PRODUCTIVITY HUB
// ----------------------------------------------------
const systemPromptOptimizers = {
  coder: {
    gemini: "SYSTEM DIRECTIVE: You are an expert system-level engineer. Output production-ready modular code containing detailed error safety structures.\nCONTEXT: The user needs a script to run tasks.\nCONSTRAINTS: Avoid placeholders. Keep logic self-contained.\nUSER TASK: ",
    claude: "System: Act as a Principal Architect. Provide a thorough, optimized file layout with standard architectural separation, keeping readability high.\nInput: "
  },
  copywriter: {
    gemini: "SYSTEM DIRECTIVE: You are a direct-response copywriter specialized in selling SaaS subscriptions. Draft copy that triggers interest with clean bullets.\nUSER TASK: ",
    claude: "System: Copywriting Engine. Use psychological triggers, emotional framing, and bold structural spacing to improve conversion rates.\nInput: "
  },
  analyst: {
    gemini: "SYSTEM DIRECTIVE: You are a Lead Business Analyst. Summarize user logs, extract key tables, list anomalies, and map correlations.\nUSER TASK: ",
    claude: "System: Senior Analyst. Outline data logs into high-level visual charts, summaries, and action bullets.\nInput: "
  }
};

const productivityTemplates = {
  email: `Subject: Automated lead qualification for [Topic] - Quick Question

Hi [Name],

I saw your team is manually managing sales leads. We created a custom AI automation workflow for [Topic] that automatically qualifies inbound webhooks and schedules calendar demos.

It saves about 10-15 hours of manual work weekly. 

Would you be open to a quick 5-minute demo tomorrow?

Best,
${userProfile?.name || 'Mithu'}
AI Engineer`,
  proposal: `Hi there,

I am ${userProfile?.name || 'Mithu'}, an AI and Automation Specialist. I read your requirements for [Topic].

I can configure a complete n8n / Make workflow pipeline that:
1. Triggers on your webforms/webhooks
2. Employs Gemini / GPT-4o agents for data classification
3. Syncs immediately with your Google Sheets/CRM database

I have built 15+ custom SaaS automations similar to [Topic]. You can check my profile for reviews.

Let's hop on a call to plan the exact flow mapping.

Best regards,
${userProfile?.name || 'Mithu'}`,
  script: `[SCENE 1: Introduction - 0:00]
(Visual: Fast panning cyberpunk workspace, holographic screens glowing)
Voiceover: "This is how we built a fully autonomous AI agent to sell SaaS. Let me show you how to automate [Topic] step-by-step..."

[SCENE 2: The Core Code - 0:15]
(Visual: Split screen showing code editor and workflow canvas)
Voiceover: "Here is the webhook receiver. It takes lead data, passes it to the AI LLM logic, and appends it immediately into our Google Sheet."

[SCENE 3: CTA - 0:45]
(Visual: Glowing purple screen with template download link)
Voiceover: "Stop doing manual copy-paste work. Subscribe to get our complete automation blueprints. Let's build!"`,
  presentation: `# Pitch Outline: [Topic]

## Slide 1: The Problem
- Manual operations waste valuable engineering time
- Data errors in manual CRM logs slow down lead response rates

## Slide 2: The AI Solution
- Deploy automated webhook receivers for [Topic]
- Run sentiment analysis and profiling on autopilot

## Slide 3: Expected ROI
- 80% decrease in lead processing times
- Zero manual input errors`
};

let currentSelectedTemplateType = "email";

function initializeFundamentalsHub() {
  const btnOptimize = document.getElementById('btnOptimizePrompt');
  const btnCompile = document.getElementById('btnCompileTemplate');
  const btnCopy = document.getElementById('btnCopyDocument');
  
  // Template select buttons
  const templateBtns = document.querySelectorAll('.prod-btn-select');
  templateBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      templateBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentSelectedTemplateType = btn.getAttribute('data-template');
      
      // Update input label based on template
      const label = document.getElementById('labelTemplateTopic');
      if (currentSelectedTemplateType === 'email') {
        label.textContent = "SaaS Product / Offer Name";
      } else if (currentSelectedTemplateType === 'proposal') {
        label.textContent = "Client Project/Upwork Job Name";
      } else {
        label.textContent = "Video / Presentation Topic";
      }
    });
  });

  // ── AI Mode Toggle ─────────────────────────────────────────────
  const fundToggle = document.getElementById('fundAiToggle');
  let aiModeEnabled = localStorage.getItem('fundAiMode') === 'true';
  fundToggle.checked = aiModeEnabled;
  if (aiModeEnabled) {
    document.getElementById('fundToggleLabel').textContent = '⚡ Local';
    document.getElementById('fundAiLabel').textContent = '🤖 Real AI';
  }

  fundToggle.addEventListener('change', () => {
    aiModeEnabled = fundToggle.checked;
    localStorage.setItem('fundAiMode', aiModeEnabled ? 'true' : 'false');
    document.getElementById('fundToggleLabel').textContent = aiModeEnabled ? '⚡ Local' : '⚡ Local Mode';
    document.getElementById('fundAiLabel').textContent = aiModeEnabled ? '🤖 Real AI' : '🤖 Real AI';
    const msg = aiModeEnabled ? 'AI Mode ON — Gemini will generate real content' : 'Local Mode — using static templates';
    printToTerminal(`[AI Mode] ${msg}`, 'output-info');
  });

  // ── AI helper ────────────────────────────────────────────────────
  async function callAiGenerate(type, payload) {
    const res = await fetch('/api/ai/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, ...payload })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'AI request failed');
    return data;
  }

  function setButtonLoading(btn, loading) {
    if (loading) {
      btn.disabled = true;
      const span = document.createElement('span');
      span.className = 'compiling-spinner';
      span.id = 'btnSpinner';
      span.innerHTML = '⏳ Generating with AI...';
      btn.innerHTML = '';
      btn.appendChild(span);
    } else {
      btn.disabled = false;
      btn.innerHTML = btn.getAttribute('data-original-html') || btn.innerHTML;
    }
  }

  // Save original button HTML for restore
  [btnOptimize, btnCompile].forEach(btn => {
    btn.setAttribute('data-original-html', btn.innerHTML);
  });

  // Enhance Optimize Prompt button
  btnOptimize.addEventListener('click', async () => {
    const rawPrompt = document.getElementById('userRawPrompt').value.trim();
    if (!rawPrompt) {
      alert('Please enter a raw user prompt first!');
      return;
    }

    if (!aiModeEnabled) {
      // Local mode — existing behavior
      const type = document.getElementById('promptSystemType').value;
      const prompts = systemPromptOptimizers[type];
      document.getElementById('outputGeminiPrompt').textContent = `${prompts.gemini}${rawPrompt}`;
      document.getElementById('outputClaudePrompt').textContent = `${prompts.claude}${rawPrompt}`;
      document.getElementById('promptComparisonResults').classList.remove('hidden');
      printToTerminal(`[Prompt Optimizer] Structured prompts generated locally.`, 'output-info');
      return;
    }

    // AI mode
    setButtonLoading(btnOptimize, true);
    try {
      const systemType = document.getElementById('promptSystemType').value;
      const data = await callAiGenerate('optimize', { systemType, prompt: rawPrompt });
      if (data.type === 'optimize') {
        document.getElementById('outputGeminiPrompt').textContent = data.gemini || 'No output';
        document.getElementById('outputClaudePrompt').textContent = data.claude || 'No output';
        document.getElementById('promptComparisonResults').classList.remove('hidden');
        printToTerminal(`[AI Generator] Gemini-powered prompt optimization complete.`, 'output-info');
      }
    } catch (err) {
      printToTerminal(`[AI Generator] Error: ${err.message}. Falling back to local.`, 'output-error');
      // Fallback to local
      const type = document.getElementById('promptSystemType').value;
      const prompts = systemPromptOptimizers[type];
      document.getElementById('outputGeminiPrompt').textContent = `${prompts.gemini}${rawPrompt}`;
      document.getElementById('outputClaudePrompt').textContent = `${prompts.claude}${rawPrompt}`;
      document.getElementById('promptComparisonResults').classList.remove('hidden');
    } finally {
      setButtonLoading(btnOptimize, false);
    }
  });

  // Enhance Compile Template button
  btnCompile.addEventListener('click', async () => {
    const topicVal = document.getElementById('templateTopicInput').value.trim();
    if (!topicVal) {
      alert('Please input a topic name first!');
      return;
    }

    if (!aiModeEnabled) {
      // Local mode — existing behavior
      let text = productivityTemplates[currentSelectedTemplateType];
      text = text.replace(/\[Topic\]/g, topicVal);
      document.getElementById('documentTextArea').value = text;
      printToTerminal(`[Productivity Hub] Compiled document template for: ${topicVal}`, 'output-info');
      return;
    }

    // AI mode
    setButtonLoading(btnCompile, true);
    try {
      const data = await callAiGenerate('compile', { templateType: currentSelectedTemplateType, topic: topicVal });
      if (data.type === 'compile') {
        document.getElementById('documentTextArea').value = data.content || 'No content generated';
        printToTerminal(`[AI Generator] Gemini-powered document generated for: ${topicVal}`, 'output-info');
      }
    } catch (err) {
      printToTerminal(`[AI Generator] Error: ${err.message}. Falling back to local.`, 'output-error');
      // Fallback to local
      let text = productivityTemplates[currentSelectedTemplateType];
      text = text.replace(/\[Topic\]/g, topicVal);
      document.getElementById('documentTextArea').value = text;
    } finally {
      setButtonLoading(btnCompile, false);
    }
  });

  // Copy
  btnCopy.addEventListener('click', () => {
    const textVal = document.getElementById('documentTextArea').value;
    navigator.clipboard.writeText(textVal).then(() => {
      btnCopy.textContent = "Copied!";
      setTimeout(() => { btnCopy.textContent = "Copy"; }, 2000);
      printToTerminal(`[System] Copied template to clipboard.`, 'output-info');
    });
  });
}

// ----------------------------------------------------
// 7. AI TOOLS
// ----------------------------------------------------
function initializeAiTools() {
  // Helper to call AI API endpoints
  async function callAiTool(endpoint, payload) {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  function showResult(elId, content) {
    const el = document.getElementById(elId);
    const parent = el?.closest('.aitool-result');
    if (parent) parent.classList.remove('hidden');
    if (el) el.innerHTML = content;
  }

  function setBtnLoading(btn, loading) {
    if (!btn) return;
    btn.disabled = loading;
    if (loading) {
      btn._origText = btn.innerHTML;
      btn.innerHTML = '<span class="compiling-spinner">⏳ Processing...</span>';
    } else {
      btn.innerHTML = btn._origText || btn.innerHTML;
    }
  }

  // ── 1. Schedule Optimizer ─────────────────────────────────────────
  const btnSchedule = document.getElementById('btnOptimizeSchedule');
  if (btnSchedule) {
    btnSchedule.addEventListener('click', async () => {
      const niche = document.getElementById('aiScheduleNiche')?.value?.trim() || 'AI Automation';
      const platform = document.getElementById('aiSchedulePlatform')?.value || 'facebook';
      setBtnLoading(btnSchedule, true);
      try {
        const data = await callAiTool('/api/ai/schedule-optimize', { niche, platform });
        let html = '<div class="schedule-result-grid">';
        (data.bestTimes || []).forEach(t => {
          html += `<div class="schedule-time-card"><span class="st-time">${t.time}</span><span class="st-day">${t.day}</span><span class="st-reason">${t.reason}</span></div>`;
        });
        html += '</div>';
        if (data.frequency) html += `<p class="schedule-freq"><strong>📊 Frequency:</strong> ${data.frequency}</p>`;
        if (data.worstTimes) html += `<p class="schedule-worst"><strong>⚠️ Avoid:</strong> ${data.worstTimes}</p>`;
        if (data.explanation) html += `<p class="schedule-explain">💡 ${data.explanation}</p>`;
        html += `<span class="generated-by-ai">Powered by ${data.source === 'gemini' ? 'Gemini AI' : 'local engine'}</span>`;
        showResult('scheduleResultContent', html);
      } catch (err) {
        showResult('scheduleResultContent', `<p class="error">Error: ${err.message}</p>`);
      } finally {
        setBtnLoading(btnSchedule, false);
      }
    });
  }

  // ── 2. Post Performance Analyzer ──────────────────────────────────
  const btnPerf = document.getElementById('btnAnalyzePost');
  if (btnPerf) {
    btnPerf.addEventListener('click', async () => {
      const content = document.getElementById('aiPerfPost')?.value?.trim();
      if (!content) { alert('Please enter post content!'); return; }
      const type = document.getElementById('aiPerfType')?.value || 'promotional';
      setBtnLoading(btnPerf, true);
      try {
        const data = await callAiTool('/api/ai/analyze-performance', { content, type });
        let html = `<div class="perf-score"><div class="perf-score-num" style="color:${data.score > 70 ? 'var(--success)' : data.score > 40 ? 'var(--warning)' : 'var(--danger)'}">${data.score}/100</div><span>Engagement Score</span></div>`;
        if (data.viralPotential) html += `<p><strong>🔥 Viral Potential:</strong> <span style="color:${data.viralPotential === 'High' ? 'var(--success)' : 'var(--warning)'}">${data.viralPotential}</span></p>`;
        if (data.strengths) html += `<p><strong>✅ What\'s Working:</strong> ${data.strengths}</p>`;
        if (data.suggestions?.length) {
          html += '<div class="perf-suggestions"><strong>💡 Suggestions:</strong><ul>';
          data.suggestions.forEach(s => { html += `<li>${s}</li>`; });
          html += '</ul></div>';
        }
        if (data.formatRecommendation) html += `<p><strong>📐 Format Tip:</strong> ${data.formatRecommendation}</p>`;
        html += `<span class="generated-by-ai">Powered by ${data.source === 'gemini' ? 'Gemini AI' : 'local engine'}</span>`;
        showResult('perfResultContent', html);
      } catch (err) {
        showResult('perfResultContent', `<p class="error">Error: ${err.message}</p>`);
      } finally {
        setBtnLoading(btnPerf, false);
      }
    });
  }

  // ── 3. Hashtag & SEO Generator ────────────────────────────────────
  const btnHashtag = document.getElementById('btnGenerateHashtags');
  if (btnHashtag) {
    btnHashtag.addEventListener('click', async () => {
      const topic = document.getElementById('aiHashtagTopic')?.value?.trim();
      if (!topic) { alert('Please enter a topic!'); return; }
      const platform = document.getElementById('aiHashtagPlatform')?.value || 'facebook';
      setBtnLoading(btnHashtag, true);
      try {
        const data = await callAiTool('/api/ai/hashtags', { topic, platform });
        let html = '';
        if (data.hashtags?.length) {
          html += '<div class="ht-section"><strong>🏷️ Trending Hashtags</strong><div class="ht-tags">';
          data.hashtags.forEach(h => { html += `<span class="ht-tag">${h}</span>`; });
          html += '</div></div>';
        }
        if (data.seoTitles?.length) {
          html += '<div class="ht-section"><strong>📰 SEO Titles</strong><ul>';
          data.seoTitles.forEach(t => { html += `<li>${t}</li>`; });
          html += '</ul></div>';
        }
        if (data.metaDescription) html += `<div class="ht-section"><strong>📝 Meta Description</strong><p class="ht-meta">${data.metaDescription}</p></div>`;
        if (data.trendingScore !== undefined) html += `<p><strong>📈 Trending Score:</strong> <span style="color:${data.trendingScore > 70 ? 'var(--success)' : 'var(--warning)'}">${data.trendingScore}/100</span></p>`;
        if (data.angles?.length) {
          html += '<div class="ht-section"><strong>🎯 Content Angles</strong><ul>';
          data.angles.forEach(a => { html += `<li>${a}</li>`; });
          html += '</ul></div>';
        }
        html += `<span class="generated-by-ai">Powered by ${data.source === 'gemini' ? 'Gemini AI' : 'local engine'}</span>`;
        showResult('hashtagResultContent', html);
      } catch (err) {
        showResult('hashtagResultContent', `<p class="error">Error: ${err.message}</p>`);
      } finally {
        setBtnLoading(btnHashtag, false);
      }
    });
  }

  // ── 4. Image Analyzer ─────────────────────────────────────────────
  const dropzone = document.getElementById('aiImageDropzone');
  const fileInput = document.getElementById('aiImageInput');
  const preview = document.getElementById('aiImagePreview');
  const previewImg = document.getElementById('aiImagePreviewImg');
  const removeBtn = document.getElementById('aiImageRemoveBtn');
  const analyzeBtn = document.getElementById('btnAnalyzeImage');
  let currentImageB64 = '';

  if (dropzone && fileInput) {
    dropzone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        currentImageB64 = ev.target.result;
        previewImg.src = currentImageB64;
        preview.classList.remove('hidden');
        dropzone.classList.add('hidden');
        if (analyzeBtn) analyzeBtn.disabled = false;
      };
      reader.readAsDataURL(file);
    });
  }

  if (removeBtn && preview && dropzone) {
    removeBtn.addEventListener('click', () => {
      currentImageB64 = '';
      preview.classList.add('hidden');
      previewImg.src = '';
      dropzone.classList.remove('hidden');
      fileInput.value = '';
      if (analyzeBtn) analyzeBtn.disabled = true;
      const res = document.getElementById('imageResult');
      if (res) res.classList.add('hidden');
    });
  }

  if (analyzeBtn) {
    analyzeBtn.addEventListener('click', async () => {
      if (!currentImageB64) { alert('Please upload an image first!'); return; }
      setBtnLoading(analyzeBtn, true);
      try {
        const data = await callAiTool('/api/ai/analyze-image', { image: currentImageB64 });
        let html = '';
        if (data.caption) html += `<div class="ht-section"><strong>📝 Caption</strong><p class="ht-meta">${data.caption}</p></div>`;
        if (data.description) html += `<div class="ht-section"><strong>📋 Description</strong><p>${data.description}</p></div>`;
        if (data.hashtags?.length) {
          html += '<div class="ht-section"><strong>🏷️ Hashtags</strong><div class="ht-tags">';
          data.hashtags.forEach(h => { html += `<span class="ht-tag">${h}</span>`; });
          html += '</div></div>';
        }
        if (data.seoTitles?.length) {
          html += '<div class="ht-section"><strong>📰 SEO Titles</strong><ul>';
          data.seoTitles.forEach(t => { html += `<li>${t}</li>`; });
          html += '</ul></div>';
        }
        if (data.aestheticScore !== undefined) html += `<p><strong>🎨 Aesthetic Score:</strong> <span style="color:${data.aestheticScore > 70 ? 'var(--success)' : 'var(--warning)'}">${data.aestheticScore}/100</span></p>`;
        html += `<span class="generated-by-ai">Powered by ${data.source === 'gemini' ? 'Gemini AI Vision' : 'local engine'}</span>`;
        showResult('imageResultContent', html);
      } catch (err) {
        showResult('imageResultContent', `<p class="error">Error: ${err.message}</p>`);
      } finally {
        setBtnLoading(analyzeBtn, false);
      }
    });
  }
}

// ── Overview Dashboard Stats ────────────────────────────────────
async function refreshOverviewStats() {
  try {
    const res = await fetch('/api/stats');
    const data = await res.json();
    if (!data) return;

    const setText = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };

    setText('statPostsPosted', data.queuePosted ?? 0);
    setText('statQueuePending', data.queuePending ?? 0);
    setText('statMediaGenerated', data.mediaGenerated ?? 0);
    setText('statWorkflows', `${data.workflowActive ?? 0} / ${data.workflowTotal ?? 0}`);
    setText('statRunsCompleted', data.runsCompleted ?? 0);
    setText('statRunsFailed', data.runsFailed ?? 0);

    // Recent activity
    const activityEl = document.getElementById('recentActivity');
    if (activityEl && data.recentActivity) {
      if (data.recentActivity.length === 0) {
        activityEl.innerHTML = '<div class="recent-empty">No activity yet. Run a workflow to see results.</div>';
      } else {
        activityEl.innerHTML = data.recentActivity.map(r => {
          const status = (r.status === 'completed' || r.status === 'success') ? 'completed' : (r.status === 'error' || r.status === 'failed') ? 'error' : 'running';
          const time = r.createdAt ? new Date(r.createdAt).toLocaleTimeString() : '--';
          const name = r.workflowName || r.id || 'Workflow';
          return `<div class="recent-item">
            <span class="recent-status ${status}"></span>
            <span class="recent-name">${name}</span>
            <span class="recent-time">${time}</span>
          </div>`;
        }).join('');
      }
    }

    printToTerminal(`[Dashboard] Stats refreshed: ${data.queuePending} queued, ${data.runsCompleted} completed`, 'output-info');
  } catch (e) {
    console.warn('Stats refresh failed:', e);
  }
}

// Auto-refresh every 30 seconds
setInterval(refreshOverviewStats, 30000);

window.triggerDownload = async function(projectId) {
  const proj = projectsList.find(p => p.id === projectId);
  if (!proj) return;

  printToTerminal(`[Downloader] Starting download for: ${proj.name}...`, 'output-info');

  if (isElectron) {
    try {
      proj.downloading = true;
      proj.percent = 0;
      
      const result = await window.electronAPI.downloadProject(projectId);
      if (result.status === 'completed') {
        proj.downloading = false;
        proj.downloaded = true;
        printToTerminal(`[Success] ${proj.name} is already available locally.`, 'output-success');
      }
    } catch (err) {
      proj.downloading = false;
      printToTerminal(`[Error] Failed to initiate download: ${err.message}`, 'output-error');
    }
  } else {
    if (browserDownloadStates.has(projectId)) return;
    
    proj.downloading = true;
    proj.percent = 0;
    
    let percent = 0;
    const interval = setInterval(() => {
      percent += Math.floor(Math.random() * 15) + 5;
      if (percent >= 100) {
        percent = 100;
        clearInterval(interval);
        browserDownloadStates.delete(projectId);
        
        proj.downloading = false;
        proj.downloaded = true;
        
        localStorage.setItem(`dl_${projectId}`, 'true');
        printToTerminal(`[System] Browser-mode download progress completed locally for ${proj.name}, but no verified external download integration is connected.`, 'output-warning');
      } else {
        handleDownloadProgress({
          projectId,
          percent,
          bytes: Math.round((percent / 100) * 50000),
          total: 50000,
          status: 'downloading'
        });
      }
    }, 300);
    
    browserDownloadStates.set(projectId, interval);
  }
};

window.openProjectFolder = function(projectId) {
  if (isElectron) {
    window.electronAPI.openProjectFolder(projectId);
    printToTerminal(`[System] Show project files for ID: ${projectId}`, 'output-info');
  } else {
    printToTerminal(`[System] Open folder is unavailable in browser mode for ID: ${projectId}`, 'output-warning');
    alert(`Browser mode cannot open local folders automatically. Expected path: ${localDownloadDir}/${projectId}.zip`);
  }
};

function handleDownloadProgress(data) {
  const { projectId, percent, bytes, total, status, error } = data;
  const proj = projectsList.find(p => p.id === projectId);
  if (!proj) return;

  if (status === 'downloading') {
    proj.downloading = true;
    proj.percent = percent;
    
    const fill = document.getElementById(`progress-fill-${projectId}`);
    const text = document.getElementById(`progress-text-${projectId}`);
    
    if (fill) fill.style.width = `${percent}%`;
    if (text) {
      if (percent === -1) {
        text.textContent = `Downloading (${(bytes / 1024).toFixed(0)} KB)`;
      } else {
        text.textContent = `Downloading (${percent}%)`;
      }
    }
  } else if (status === 'completed') {
    proj.downloading = false;
    proj.downloaded = true;
    proj.percent = 100;
    printToTerminal(`[Success] ${proj.name} has finished downloading!`, 'output-success');
  } else if (status === 'failed') {
    proj.downloading = false;
    proj.percent = 0;
    printToTerminal(`[Error] Download failed for ${proj.name}: ${error}`, 'output-error');
  }
}

// ----------------------------------------------------
// Terminal CLI Control & Execution (Original CLI Commands)
// ----------------------------------------------------
function toggleTerminal() {
  terminalDock.classList.toggle('collapsed');
  const isCollapsed = terminalDock.classList.contains('collapsed');
  if (!isCollapsed) {
    terminalInput.focus();
  }
}

function processCommand(rawInput) {
  const cleanInput = rawInput.trim();
  printToTerminal(`prime-cli$ ${cleanInput}`, 'command-echo');
  
  const tokens = cleanInput.split(/\s+/);
  const command = tokens[0].toLowerCase();
  const args = tokens.slice(1);
  
  switch(command) {
    case 'help':
      executeHelp();
      break;
    case 'list-projects':
      executeListProjects();
      break;
    case 'info':
      executeInfo(args[0]);
      break;
    case 'download':
      executeDownload(args[0]);
      break;
    case 'clear':
      terminalOutput.innerHTML = '';
      break;
    case 'status':
      executeStatus();
      break;
    case 'run-flow':
      executeRunFlow(args[0]);
      break;
    case 'chat':
      executeCLIChat(args.join(' '));
      break;
    case 'agent':
      executeAgentSwitch(args[0]);
      break;
    default:
      printToTerminal(`Command not found: '${command}'. Type 'help' to list all commands.`, 'output-error');
  }
}

function executeHelp() {
  printToTerminal('─────────────────────────────────────', 'output-header');
  printToTerminal('  PRIME AI HUB  ·  CLI v2.0 COMMANDS ', 'output-header');
  printToTerminal('─────────────────────────────────────', 'output-header');
  printToTerminal('  WORKSPACE');
  printToTerminal('    status              Show platform health overview');
  printToTerminal('    run-flow <name>     Run a workflow: fb | yt | saas');
  printToTerminal('  ');
  printToTerminal('  AI AGENT BOT');
  printToTerminal('    chat <message>      Send a message to the active AI agent');
  printToTerminal('    agent <name>        Switch agent: support | sales | universal');
  printToTerminal('  ');
  printToTerminal('  TEMPLATES');
  printToTerminal('    list-projects       List downloadable project templates');
  printToTerminal('    info <id>           Show details for a project template');
  printToTerminal('    download <id>       Download a project ZIP to your machine');
  printToTerminal('  ');
  printToTerminal('  UTILITY');
  printToTerminal('    clear               Clear the terminal screen');
  printToTerminal('    help                Show this help menu');
  printToTerminal('─────────────────────────────────────', 'output-header');
}

function executeListProjects() {
  printToTerminal('--- PROJECT BUNDLES LIST ---', 'output-header');
  projectsList.forEach(proj => {
    const statusText = proj.downloaded ? 'Ready' : (proj.downloading ? `Downloading (${proj.percent}%)` : 'Not Saved');
    printToTerminal(`[${proj.id}] ${proj.name} (${proj.fileSize}) - Status: ${statusText}`);
  });
  printToTerminal('----------------------------', 'output-header');
}

function executeInfo(projectId) {
  if (!projectId) {
    printToTerminal('Usage: info <project-id>. Use list-projects to find project IDs.', 'output-error');
    return;
  }
  
  const proj = projectsList.find(p => p.id === projectId);
  if (!proj) {
    printToTerminal(`Project ID not found: '${projectId}'`, 'output-error');
    return;
  }
  
  printToTerminal(`--- INFO: ${proj.name.toUpperCase()} ---`, 'output-header');
  printToTerminal(`ID:          ${proj.id}`);
  printToTerminal(`Tag:         ${proj.tag}`);
  printToTerminal(`Version:     ${proj.version}`);
  printToTerminal(`File Size:   ${proj.fileSize}`);
  printToTerminal(`URL:         ${proj.downloadUrl}`);
  printToTerminal(`Description: ${proj.description}`);
  printToTerminal(`Local Status: ${proj.downloaded ? 'Downloaded (Ready)' : 'Not Downloaded'}`);
  printToTerminal('-------------------------------------', 'output-header');
}

function executeDownload(projectId) {
  if (!projectId) {
    printToTerminal('Usage: download <project-id>. Use list-projects to find project IDs.', 'output-error');
    return;
  }
  
  const proj = projectsList.find(p => p.id === projectId);
  if (!proj) {
    printToTerminal(`Project ID not found: '${projectId}'`, 'output-error');
    return;
  }
  
  if (proj.downloaded) {
    printToTerminal(`Project '${projectId}' already downloaded. Opening folder...`, 'output-info');
    openProjectFolder(projectId);
    return;
  }
  
  if (proj.downloading) {
    printToTerminal(`Project '${projectId}' download already in progress.`, 'output-error');
    return;
  }
  
  triggerDownload(projectId);
}

// ----------------------------------------------------
// CLI: Extended Commands
// ----------------------------------------------------

function executeStatus() {
  const now = new Date().toLocaleTimeString('en-BD', { hour12: false });
  printToTerminal('\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500', 'output-header');
  printToTerminal('  PRIME AI HUB \u00b7 PLATFORM STATUS', 'output-header');
  printToTerminal('\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500', 'output-header');
  printToTerminal(`  Time        : ${now}`, '');
  printToTerminal(`  Owner       : ${userProfile?.name || 'User'}`, '');
  printToTerminal(`  Agent       : Video Storyboard (AI-powered)`, '');
  printToTerminal(`  Media Count : ${mediaCount} assets generated`, '');
  printToTerminal(`  Automation  : \u2713 Facebook / \u2713 YouTube / \u2713 SaaS Webhook`, 'output-success');
  printToTerminal(`  Generative  : \u2713 Image Studio / \u2713 Video Creator`, 'output-success');
  printToTerminal(`  Agents      : \u2713 Support / \u2713 Sales / \u2713 Universal`, 'output-success');
  printToTerminal(`  Downloads   : ${projectsList.length} templates available`, '');
  printToTerminal('\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500', 'output-header');
}

function executeRunFlow(flowName) {
  if (!flowName) {
    printToTerminal('Usage: run-flow <name>   Options: fb | yt | saas', 'output-error');
    return;
  }

  const idMap = {
    fb: 'wf_fb_poster',
    yt: 'wf_yt_broadcast',
    saas: 'wf_saas_leads'
  };
  const workflowId = idMap[flowName.toLowerCase()];
  if (!workflowId) {
    printToTerminal(`Unknown flow: '${flowName}'. Choose from: fb | yt | saas`, 'output-error');
    return;
  }

  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('.viewport-section').forEach(s => s.classList.remove('active'));

  const navBtn = document.getElementById('navAutomation');
  navBtn.classList.add('active');
  document.getElementById('automation-view').classList.add('active');

  setTimeout(() => {
    if (window.AutomationEngineUI) {
      window.AutomationEngineUI.selectWorkflow(workflowId);
      printToTerminal(`[CLI] Switched to Automation Engine → ${workflowId}`, 'output-info');
      setTimeout(() => {
        printToTerminal(`[CLI] Executing workflow now...`, 'output-info');
        window.AutomationEngineUI.run();
      }, 400);
    }
  }, 200);
}

// Agent CLI functions removed — was demo/fake

function executeAgentSwitch(agentName) {
  printToTerminal('Agent workspace has been removed. Only real automation features remain.', 'output-warning');
}
// ============================================================
// 6. USER AUTHENTICATION & PROFILE SYSTEM
// ============================================================

const AUTH_I18N = {
  en: {
    heroBadge: 'Public Access',
    heroTitle: 'Turn content ideas into scheduled publishing workflows',
    heroDesc: 'Use your own account to manage automations, uploads, API integrations, and real Facebook & YouTube publishing from one secure workspace.',
    point1: 'Real local user account',
    point2: 'Protected workflow and publish actions',
    point3: 'Your own identity, not guest mode',
    heroCardTitle: 'Secure personal workspace',
    heroCardDesc: 'Create your account once, then manage Facebook, YouTube, uploads, and API settings from one place.',
    metric1: 'Page posting ready',
    metric2: 'Video upload workflow',
    metric3: 'Protected access only',
    footerStat1Title: 'All-in-one',
    footerStat1Text: 'Content, queue, publish, workflow',
    footerStat2Title: 'Local auth',
    footerStat2Text: 'No Supabase dependency',
    footerStat3Title: 'For public use',
    footerStat3Text: 'Clean sign in experience',
    supportEmail: 'mithuchandra647@gmail.com',
    supportWhatsapp: '01864339154',
    supportTelegram: '@prime@8088',
    copyright: '© 2026 SOCIAL AUTOMATION - Prime · All rights reserved.',
    panelBadge: 'Account Access',
    supportTitle: 'Need help getting started?',
    supportDesc: 'Create an account first, then connect Facebook Page, YouTube channel, and your API keys from inside the dashboard.',
    language: 'Language',
    info: 'Local account system is active. Create an account or sign in to use your real identity.',
    authTitleLogin: 'Welcome Back',
    authSubtitleLogin: 'Sign in to your Prime AI account',
    authTitleRegister: 'Create Account',
    authSubtitleRegister: 'Start your automation journey',
    tabLogin: 'Sign In',
    tabRegister: 'Create Account',
    loginEmailLabel: 'Email Address',
    loginPasswordLabel: 'Password',
    forgot: 'Forgot password?',
    remember: 'Remember me on this device',
    loginBtn: 'Sign In',
    regNameLabel: 'Full Name',
    regEmailLabel: 'Email Address',
    regPasswordLabel: 'Password',
    regConfirmLabel: 'Confirm Password',
    registerBtn: 'Create Account',
    footer: `By signing in you agree to Prime AI's <a href="#" id="openTermsLink" onclick="openLegalModal('terms'); return false;">Terms</a> & <a href="#" id="openPrivacyLink" onclick="openLegalModal('privacy'); return false;">Privacy Policy</a>.`,
    loginEmailPlaceholder: 'you@example.com',
    loginPasswordPlaceholder: '••••••••',
    regNamePlaceholder: 'Your full name',
    regEmailPlaceholder: 'you@example.com',
    regPasswordPlaceholder: 'Min 6 characters',
    regConfirmPlaceholder: 'Repeat password'
  },
  bn: {
    heroBadge: 'পাবলিক অ্যাক্সেস',
    heroTitle: 'ড্যাশবোর্ডে ঢুকতে সাইন ইন করুন',
    heroDesc: 'নিজের account দিয়ে automation, API integration, upload আর publishing actions manage করুন।',
    point1: 'রিয়েল local user account',
    point2: 'workflow আর publish action protected',
    point3: 'guest mode না, নিজের identity',
    heroCardTitle: 'নিরাপদ personal workspace',
    heroCardDesc: 'একবার account খুলে Facebook, YouTube, upload আর API settings এক জায়গা থেকে manage করুন।',
    metric1: 'Page posting ready',
    metric2: 'Video upload workflow',
    metric3: 'Protected access only',
    footerStat1Title: 'All-in-one',
    footerStat1Text: 'Content, queue, publish, workflow',
    footerStat2Title: 'Local auth',
    footerStat2Text: 'No Supabase dependency',
    footerStat3Title: 'For public use',
    footerStat3Text: 'Clean sign in experience',
    supportEmail: 'mithuchandra647@gmail.com',
    supportWhatsapp: '01864339154',
    supportTelegram: '@prime@8088',
    copyright: '© 2026 SOCIAL AUTOMATION - Prime · সর্বস্বত্ব সংরক্ষিত।',
    panelBadge: 'Account Access',
    supportTitle: 'শুরু করতে সাহায্য লাগবে?',
    supportDesc: 'আগে account খুলুন, তারপর dashboard থেকে Facebook Page, YouTube channel আর API keys connect করুন।',
    language: 'ভাষা',
    info: 'Local account system active আছে। নিজের real identity দিয়ে sign in বা sign up করুন।',
    authTitleLogin: 'আবার স্বাগতম',
    authSubtitleLogin: 'আপনার Prime AI account-এ sign in করুন',
    authTitleRegister: 'নতুন account খুলুন',
    authSubtitleRegister: 'আপনার automation journey শুরু করুন',
    tabLogin: 'Sign In',
    tabRegister: 'Sign Up',
    loginEmailLabel: 'ইমেইল অ্যাড্রেস',
    loginPasswordLabel: 'পাসওয়ার্ড',
    forgot: 'পাসওয়ার্ড ভুলে গেছেন?',
    remember: 'এই ডিভাইসে আমাকে মনে রাখুন',
    loginBtn: 'Sign In',
    regNameLabel: 'পূর্ণ নাম',
    regEmailLabel: 'ইমেইল অ্যাড্রেস',
    regPasswordLabel: 'পাসওয়ার্ড',
    regConfirmLabel: 'পাসওয়ার্ড আবার লিখুন',
    registerBtn: 'Account খুলুন',
    footer: `Sign in করলে আপনি Prime AI-এর <a href="#" id="openTermsLink" onclick="openLegalModal('terms'); return false;">Terms</a> & <a href="#" id="openPrivacyLink" onclick="openLegalModal('privacy'); return false;">Privacy Policy</a> মেনে নিচ্ছেন।`,
    loginEmailPlaceholder: 'you@example.com',
    loginPasswordPlaceholder: '••••••••',
    regNamePlaceholder: 'আপনার পূর্ণ নাম',
    regEmailPlaceholder: 'you@example.com',
    regPasswordPlaceholder: 'কমপক্ষে ৬ অক্ষর',
    regConfirmPlaceholder: 'আবার পাসওয়ার্ড লিখুন'
  }
};

async function apiJson(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });

  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }

  return data;
}

function applyAuthLanguage(mode = authLanguage) {
  authLanguage = AUTH_I18N[mode] ? mode : 'en';
  localStorage.setItem('auth_language', authLanguage);
  const t = AUTH_I18N[authLanguage];

  const mapText = {
    authHeroBadge: t.heroBadge,
    authHeroTitle: t.heroTitle,
    authHeroDesc: t.heroDesc,
    authPoint1: t.point1,
    authPoint2: t.point2,
    authPoint3: t.point3,
    authHeroCardTitle: t.heroCardTitle,
    authHeroCardDesc: t.heroCardDesc,
    authMetric1: t.metric1,
    authMetric2: t.metric2,
    authMetric3: t.metric3,
    authFooterStat1Title: t.footerStat1Title,
    authFooterStat1Text: t.footerStat1Text,
    authFooterStat2Title: t.footerStat2Title,
    authFooterStat2Text: t.footerStat2Text,
    authFooterStat3Title: t.footerStat3Title,
    authFooterStat3Text: t.footerStat3Text,
    authPanelBadge: t.panelBadge,
    authSupportTitle: t.supportTitle,
    authSupportDesc: t.supportDesc,
    authSupportEmail: t.supportEmail,
    authSupportWhatsapp: t.supportWhatsapp,
    authSupportTelegram: t.supportTelegram,
    authSupportEmailLink: t.supportEmail,
    authSupportWhatsappLink: `WhatsApp: ${t.supportWhatsapp}`,
    authSupportTelegramText: `Telegram: ${t.supportTelegram}`,
    authCopyright: t.copyright,
    authLanguageLabel: t.language,
    authInfoMessage: t.info,
    loginEmailLabel: t.loginEmailLabel,
    loginPasswordLabel: t.loginPasswordLabel,
    forgotLink: t.forgot,
    rememberMeText: t.remember,
    loginBtnText: t.loginBtn,
    regNameLabel: t.regNameLabel,
    regEmailLabel: t.regEmailLabel,
    regPasswordLabel: t.regPasswordLabel,
    regConfirmLabel: t.regConfirmLabel,
    registerBtnText: t.registerBtn,
    tabLogin: t.tabLogin,
    tabRegister: t.tabRegister
  };

  Object.entries(mapText).forEach(([id, value]) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  });

  const footer = document.getElementById('authFooterNote');
  if (footer) footer.innerHTML = t.footer;

  const loginEmail = document.getElementById('loginEmail');
  const loginPassword = document.getElementById('loginPassword');
  const regName = document.getElementById('regName');
  const regEmail = document.getElementById('regEmail');
  const regPassword = document.getElementById('regPassword');
  const regConfirm = document.getElementById('regConfirm');
  if (loginEmail) loginEmail.placeholder = t.loginEmailPlaceholder;
  if (loginPassword) loginPassword.placeholder = t.loginPasswordPlaceholder;
  if (regName) regName.placeholder = t.regNamePlaceholder;
  if (regEmail) regEmail.placeholder = t.regEmailPlaceholder;
  if (regPassword) regPassword.placeholder = t.regPasswordPlaceholder;
  if (regConfirm) regConfirm.placeholder = t.regConfirmPlaceholder;

  const select = document.getElementById('authLanguageSelect');
  if (select) select.value = authLanguage;
  switchAuthTab(tabRegister && tabRegister.classList.contains('active') ? 'register' : 'login');
}

function requireSignedIn(actionLabel = 'continue') {
  if (userProfile) return true;
  showAuthMessage(`Please sign in to ${actionLabel}.`, 'info');
  if (authOverlay) {
    authOverlay.classList.remove('hidden');
    switchAuthTab('login');
  }
  printToTerminal(`[Auth] Sign in required to ${actionLabel}.`, 'output-warning');
  return false;
}

function showAuthMessage(message, type) {
  const authMessage = document.getElementById('authMessage');
  if (!authMessage) return;
  authMessage.textContent = message;
  authMessage.classList.remove('hidden', 'success', 'error', 'info');
  if (type === 'success') {
    authMessage.classList.add('success');
    authMessage.style.color = '#10b981';
    authMessage.style.marginBottom = '15px';
  } else if (type === 'error') {
    authMessage.classList.add('error');
    authMessage.style.color = '#ef4444';
    authMessage.style.marginBottom = '15px';
  } else {
    authMessage.classList.add('info');
    authMessage.style.color = '#3b82f6';
    authMessage.style.marginBottom = '15px';
  }
}

function updateOverviewIdentityState() {
  const title = document.getElementById('overviewWelcomeTitle');
  const subtitle = document.getElementById('overviewWelcomeSubtitle');
  if (!title || !subtitle) return;

  if (userProfile && userProfile.name) {
    title.textContent = `Welcome, ${userProfile.name}`;
    subtitle.textContent = 'Manage your automations, uploads, workflows, and connected services.';
  } else {
    title.textContent = 'Welcome';
    subtitle.textContent = 'Sign in to manage your automations and connected services.';
  }
}

function setAuthenticatedLayout(isSignedIn) {
  // No login system — dashboard always visible
  const appContainer = document.querySelector('.app-container');
  const titlebar = document.querySelector('.titlebar');
  if (appContainer) appContainer.style.display = 'flex';
  if (titlebar) titlebar.style.display = 'flex';
}

function applySignedInSession(profile) {
  userProfile = profile;
  setAuthenticatedLayout(true);
  updateUserUISignedIn();
  updateOverviewIdentityState();
  if (authCloseBtn) authCloseBtn.style.display = '';
  // Hide auth overlay, show dashboard
  if (authOverlay) authOverlay.classList.add('hidden');
  const appContainer = document.querySelector('.app-container');
  const titlebar = document.querySelector('.titlebar');
  if (appContainer) appContainer.style.display = 'flex';
  if (titlebar) titlebar.style.display = 'flex';
  printToTerminal(`[Auth] User logged in: ${userProfile.name}`, 'output-success');
  printToOverviewLogs(`User identity active: '${userProfile.name}'`, 'success');

  // Force activate Overview Dashboard after login (prevents black screen)
  setTimeout(() => {
    const overviewView = document.getElementById('overview-view');
    const overviewNav = document.getElementById('navOverview');
    if (overviewView && overviewNav) {
      document.querySelectorAll('.viewport-section').forEach(s => s.classList.remove('active'));
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      overviewView.classList.add('active');
      overviewNav.classList.add('active');
      if (typeof refreshOverviewStats === 'function') refreshOverviewStats();
    }
  }, 50);
}

function applySignedOutSession({ forceLogin = false } = {}) {
  userProfile = null;
  // No login — dashboard always visible
  updateUserUISignedOut();
  updateOverviewIdentityState();
}

async function initializeAuthAndProfile() {
  flowsExecutedCount = parseInt(localStorage.getItem('stat_flows') || '0', 10);
  aiConversationsCount = parseInt(localStorage.getItem('stat_chats') || '0', 10);

  applyAuthLanguage(authLanguage);

  const authLanguageSelect = document.getElementById('authLanguageSelect');
  if (authLanguageSelect) {
    authLanguageSelect.value = authLanguage;
    authLanguageSelect.addEventListener('change', () => applyAuthLanguage(authLanguageSelect.value));
  }

  if (openAuthBtn) {
    openAuthBtn.addEventListener('click', () => {
      if (authOverlay) authOverlay.classList.remove('hidden');
      const appContainer = document.querySelector('.app-container');
      const titlebar = document.querySelector('.titlebar');
      if (appContainer) appContainer.style.display = 'none';
      if (titlebar) titlebar.style.display = 'none';
      switchAuthTab('login');
    });
  }

  // Check if already logged in via session
  try {
    const data = await apiJson('/api/auth/me');
    if (data && data.user) {
      applySignedInSession(data.user);
      return; // Already logged in, skip auth screen
    }
  } catch {}

  // Not logged in — show auth overlay, hide dashboard
  if (authOverlay) {
    authOverlay.classList.remove('hidden');
    const appContainer = document.querySelector('.app-container');
    const titlebar = document.querySelector('.titlebar');
    if (appContainer) appContainer.style.display = 'none';
    if (titlebar) titlebar.style.display = 'none';
  }

  if (openProfileBtn) {
    openProfileBtn.addEventListener('click', () => {
      refreshProfileStats();
      profileOverlay.classList.remove('hidden');
    });
  }

  if (authCloseBtn) {
    authCloseBtn.addEventListener('click', () => {
      if (userProfile) {
        if (authOverlay) authOverlay.classList.add('hidden');
        const appContainer = document.querySelector('.app-container');
        const titlebar = document.querySelector('.titlebar');
        if (appContainer) appContainer.style.display = 'flex';
        if (titlebar) titlebar.style.display = 'flex';
      }
    });
  }

  if (profileCloseBtn) {
    profileCloseBtn.addEventListener('click', () => {
      profileOverlay.classList.add('hidden');
    });
  }

  if (authOverlay) {
    authOverlay.addEventListener('click', (e) => {
      if (e.target === authOverlay && userProfile) {
        if (authOverlay) authOverlay.classList.add('hidden');
        const appContainer = document.querySelector('.app-container');
        const titlebar = document.querySelector('.titlebar');
        if (appContainer) appContainer.style.display = 'flex';
        if (titlebar) titlebar.style.display = 'flex';
      }
    });
  }

  profileOverlay.addEventListener('click', (e) => {
    if (e.target === profileOverlay) profileOverlay.classList.add('hidden');
  });

  if (tabLogin) {
    tabLogin.addEventListener('click', () => switchAuthTab('login'));
  }
  if (tabRegister) {
    tabRegister.addEventListener('click', () => switchAuthTab('register'));
  }

  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('loginEmail').value.trim().toLowerCase();
      const password = document.getElementById('loginPassword').value;

      if (!email || !password) {
        showAuthMessage('Please enter email and password.', 'error');
        return;
      }

      try {
        const data = await apiJson('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, password })
        });
        const rememberMe = document.getElementById('rememberMeCheckbox');
        localStorage.setItem('auth_remember_me', rememberMe && rememberMe.checked ? 'true' : 'false');
        if (data.user) applySignedInSession(data.user);
        showAuthMessage('Sign in successful!', 'success');
        loginForm.reset();
        setTimeout(() => {
          document.getElementById('authMessage').classList.add('hidden');
        }, 800);
      } catch (err) {
        showAuthMessage(err.message || 'Sign in failed.', 'error');
      }
    });
  }

  if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('regName').value.trim();
      const email = document.getElementById('regEmail').value.trim().toLowerCase();
      const password = document.getElementById('regPassword').value;
      const confirmPass = document.getElementById('regConfirm').value;

      if (!name || !email) {
        showAuthMessage('Please fill in all fields.', 'error');
        return;
      }

      if (password.length < 6) {
        showAuthMessage('Password must be at least 6 characters long.', 'error');
        return;
      }

      if (password !== confirmPass) {
        showAuthMessage('Passwords do not match!', 'error');
        return;
      }

      try {
        const data = await apiJson('/api/auth/register', {
          method: 'POST',
          body: JSON.stringify({ name, email, password })
        });
        if (data.user) {
          showAuthMessage('Account created successfully! Welcome, ' + data.user.name + ' 🎉\n\nYour data is saved to your account. When you log out and log back in, everything you create — workflows, posts, settings — will be right here waiting for you.', 'success');
          setTimeout(() => applySignedInSession(data.user), 2200);
        }
        registerForm.reset();
      } catch (err) {
        showAuthMessage(err.message || 'Account creation failed.', 'error');
      }
    });
  }

  const forgotLink = document.getElementById('forgotLink');
  const rememberMe = document.getElementById('rememberMeCheckbox');
  if (rememberMe) rememberMe.checked = localStorage.getItem('auth_remember_me') !== 'false';
  if (forgotLink) {
    forgotLink.addEventListener('click', async () => {
      showAuthMessage('Password reset is not available yet in local auth. Ask me and I can add it next.', 'info');
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      try {
        await apiJson('/api/auth/logout', { method: 'POST' });
      } catch {}
      applySignedOutSession({ forceLogin: false });
      profileOverlay.classList.add('hidden');
      // Show auth overlay again
      if (authOverlay) authOverlay.classList.remove('hidden');
      const appContainer = document.querySelector('.app-container');
      const titlebar = document.querySelector('.titlebar');
      if (appContainer) appContainer.style.display = 'none';
      if (titlebar) titlebar.style.display = 'none';
      switchAuthTab('login');
      printToTerminal(`[Auth] User logged out.`, 'output-info');
      printToOverviewLogs(`User identity cleared.`, 'info');
    });
  }
}

function switchAuthTab(mode) {
  if (!tabLogin || !tabRegister || !loginForm || !registerForm) return;
  const t = AUTH_I18N[authLanguage] || AUTH_I18N.en;
  if (mode === 'login') {
    tabLogin.classList.add('active');
    tabRegister.classList.remove('active');
    loginForm.classList.remove('hidden');
    registerForm.classList.add('hidden');
    const authTitle = document.getElementById('authTitle');
    const authSubtitle = document.getElementById('authSubtitle');
    if (authTitle) authTitle.textContent = t.authTitleLogin;
    if (authSubtitle) authSubtitle.textContent = t.authSubtitleLogin;
  } else {
    tabRegister.classList.add('active');
    tabLogin.classList.remove('active');
    registerForm.classList.remove('hidden');
    loginForm.classList.add('hidden');
    const authTitle = document.getElementById('authTitle');
    const authSubtitle = document.getElementById('authSubtitle');
    if (authTitle) authTitle.textContent = t.authTitleRegister;
    if (authSubtitle) authSubtitle.textContent = t.authSubtitleRegister;
  }
}

function updateUserUISignedIn() {
  const userCardLogged = document.getElementById('userCardLogged');
  const userCardGuest = document.getElementById('userCardGuest');
  
  if (userCardLogged && userCardGuest) {
    userCardGuest.style.display = 'none';
    userCardLogged.style.display = 'flex';
    
    // Set text values
    const initials = userProfile.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
    document.getElementById('userAvatarMini').textContent = initials;
    document.getElementById('userCardName').textContent = userProfile.name;
    document.getElementById('userCardEmail').textContent = userProfile.email;
    
    // Update profile modal text fields
    document.getElementById('profileBigAvatar').textContent = initials;
    document.getElementById('profileName').textContent = userProfile.name;
    document.getElementById('profileEmail').textContent = userProfile.email;
    document.getElementById('profileUsername').textContent = userProfile.email.split('@')[0];
    document.getElementById('profileEmailDisplay').textContent = userProfile.email;
  }
}

window.addEventListener('beforeunload', () => {
  if (localStorage.getItem('auth_remember_me') === 'false' && userProfile) {
    navigator.sendBeacon('/api/auth/logout');
  }
});

function updateUserUISignedOut() {
  const userCardLogged = document.getElementById('userCardLogged');
  const userCardGuest = document.getElementById('userCardGuest');
  const profileBigAvatar = document.getElementById('profileBigAvatar');
  const profileName = document.getElementById('profileName');
  const profileEmail = document.getElementById('profileEmail');
  const profileUsername = document.getElementById('profileUsername');
  const profileEmailDisplay = document.getElementById('profileEmailDisplay');

  if (userCardLogged && userCardGuest) {
    userCardLogged.style.display = 'none';
    userCardGuest.style.display = 'flex';
  }

  if (profileBigAvatar) profileBigAvatar.textContent = '--';
  if (profileName) profileName.textContent = 'No active user';
  if (profileEmail) profileEmail.textContent = 'Not signed in';
  if (profileUsername) profileUsername.textContent = '--';
  if (profileEmailDisplay) profileEmailDisplay.textContent = 'Not signed in';
}

function refreshProfileStats() {
  // Update numbers
  document.getElementById('pStatImages').textContent = mediaCount;
  document.getElementById('pStatFlows').textContent = flowsExecutedCount;
  document.getElementById('pStatChats').textContent = aiConversationsCount;
}

// Track execution statistics in existing simulator functions
const originalRunWorkflowSimulation = runWorkflowSimulation;
runWorkflowSimulation = async function() {
  flowsExecutedCount += 1;
  localStorage.setItem('stat_flows', flowsExecutedCount);
  return originalRunWorkflowSimulation.apply(this, arguments);
};

const originalSubmitChatMessage = submitChatMessage;
submitChatMessage = async function() {
  aiConversationsCount += 1;
  localStorage.setItem('stat_chats', aiConversationsCount);
  return originalSubmitChatMessage.apply(this, arguments);
};

// ============================================================
// 6B. VIDEO WATERMARK REMOVER
// ============================================================
function initVideoWatermarkRemover() {
  const btnRemove = document.getElementById('btnRemoveWatermark');
  if (!btnRemove) return;

  btnRemove.addEventListener('click', async () => {
    const input = document.getElementById('watermarkInput');
    const type = document.getElementById('watermarkType');
    const strength = document.getElementById('watermarkStrength');
    const resultDiv = document.getElementById('watermarkResult');
    const resultText = document.getElementById('watermarkResultText');

    const videoUrl = input ? input.value.trim() : '';
    if (!videoUrl) {
      alert('Please enter a video URL or file path!');
      return;
    }

    printToTerminal(`[Video Tools] Processing watermark removal: ${videoUrl}`, 'output-info');
    btnRemove.disabled = true;
    btnRemove.textContent = '⏳ Processing...';

    try {
      const res = await fetch('/api/video/remove-watermark', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoUrl: videoUrl,
          watermarkType: type ? type.value : 'auto',
          strength: strength ? strength.value : 'medium'
        })
      });

      const data = await res.json();
      if (data.error) throw new Error(data.error);

      resultDiv.style.display = 'block';
      resultText.textContent = data.message || 'Watermark removal process initiated. For AI-generated videos (Gemini Veo, etc.), the watermark layer has been detected and flagged for removal. Download the cleaned video from the output path.';
      printToTerminal(`[Video Tools] Watermark removal complete.`, 'output-success');
      printToOverviewLogs(`Video watermark removed (${videoUrl.slice(0, 40)}...)`, 'success');
    } catch (err) {
      resultDiv.style.display = 'block';
      resultText.textContent = 'Error: ' + (err.message || 'Failed to process video.');
      printToTerminal(`[Video Tools] Error: ${err.message}`, 'output-error');
    } finally {
      btnRemove.disabled = false;
      btnRemove.textContent = '🧹 Remove Watermark';
    }
  });
}

// ============================================================
// 7. SOCIAL AUTOPILOT SYSTEM
// ============================================================
let connectedPlatforms = { fb: false, yt: false };
let socialQueue = [];

async function syncSocialQueueFromServer() {
  try {
    const res = await fetch('/api/social/queue');
    if (!res.ok) return;
    const data = await res.json();
    const remote = Array.isArray(data.queue) ? data.queue : [];
    if (!remote.length) return;

    const existing = new Set(socialQueue.map((q) => String(q.id)));
    let added = 0;
    remote.forEach((item) => {
      if (!existing.has(String(item.id))) {
        socialQueue.unshift(item);
        existing.add(String(item.id));
        added += 1;
        // Auto Hashtag for imported items in background
        if (chkAutoHashtag && chkAutoHashtag.checked) {
          autoHashtagAndSeo(item).then(enhanced => {
            Object.assign(item, enhanced);
            localStorage.setItem('autopilot_queue', JSON.stringify(socialQueue));
            renderQueue();
          });
        }
      }
    });
    if (added > 0) {
      localStorage.setItem('autopilot_queue', JSON.stringify(socialQueue));
      renderQueue();
      printToTerminal(`[Autopilot] Imported ${added} post(s) from Automation Engine`, 'output-success');
    }
  } catch {
    // Server may be unavailable in static file mode
  }
}
window.syncSocialQueueFromServer = syncSocialQueueFromServer;

function initializeSocialAutopilot() {
  // Load saved configuration from localStorage
  const savedConns = localStorage.getItem('autopilot_conns');
  if (savedConns) {
    connectedPlatforms = JSON.parse(savedConns);
    updatePlatformUI('fb');
    updatePlatformUI('yt');
  }

  const savedQueue = localStorage.getItem('autopilot_queue');
  if (savedQueue) {
    socialQueue = JSON.parse(savedQueue);
    renderQueue();
  }

  // Merge posts created by Automation Engine backend
  syncSocialQueueFromServer();
  setInterval(syncSocialQueueFromServer, 8000);

  const savedPublish = localStorage.getItem('autopilot_publish') === 'true';
  const savedGenerate = localStorage.getItem('autopilot_generate') === 'true';
  const savedHashtag = localStorage.getItem('autopilot_hashtag') === 'true';
  if (chkAutoPublish) chkAutoPublish.checked = savedPublish;
  if (chkAutoGenerate) chkAutoGenerate.checked = savedGenerate;
  if (chkAutoHashtag) chkAutoHashtag.checked = savedHashtag;

  // Toggle checks
  if (chkAutoPublish) {
    chkAutoPublish.addEventListener('change', () => {
      localStorage.setItem('autopilot_publish', chkAutoPublish.checked);
      printToTerminal(`[Autopilot] Auto-publish setting toggled to: ${chkAutoPublish.checked}`, 'output-info');
    });
  }

  if (chkAutoGenerate) {
    chkAutoGenerate.addEventListener('change', () => {
      localStorage.setItem('autopilot_generate', chkAutoGenerate.checked);
      printToTerminal(`[Autopilot] Auto-generate content toggled to: ${chkAutoGenerate.checked}`, 'output-info');
    });
  }

  if (chkAutoHashtag) {
    chkAutoHashtag.addEventListener('change', () => {
      localStorage.setItem('autopilot_hashtag', chkAutoHashtag.checked);
      printToTerminal(`[Autopilot] Auto Hashtag & SEO toggled to: ${chkAutoHashtag.checked}`, chkAutoHashtag.checked ? 'output-success' : 'output-info');
    });
  }

  // Schedule config
  initScheduleConfig();

  // Manual upload
  initManualUpload();

  // Auto-post timer
  startAutoPostScheduler();

  // Connect triggers
  if (btnConnectFb) {
    btnConnectFb.addEventListener('click', () => toggleConnection('fb', btnConnectFb, statusFb));
  }
  if (btnConnectYt) {
    btnConnectYt.addEventListener('click', () => toggleConnection('yt', btnConnectYt, statusYt));
  }

  // Queue creators
  if (btnQueueStoryboard) {
    btnQueueStoryboard.addEventListener('click', () => {
      if (!requireSignedIn('queue posts')) return;
      const topic = document.getElementById('videoTopic').value.trim();
      if (!topic) {
        alert('Please compose a storyboard first!');
        return;
      }
      if (!connectedPlatforms.yt) {
        alert('Please connect YouTube Channel first inside Social Autopilot!');
        document.getElementById('navAutopilot').click();
        return;
      }

      // Add to queue
      const item = {
        id: Date.now(),
        title: topic.slice(0, 45) + (topic.length > 45 ? '...' : ''),
        type: 'yt',
        time: 'Today, 9:15 PM (Peak Hour)',
        media: ''
      };

      socialQueue.push(item);
      localStorage.setItem('autopilot_queue', JSON.stringify(socialQueue));
      renderQueue();
      // Auto Hashtag & SEO (updates in background)
      autoHashtagAndSeo(item).then(enhanced => {
        Object.assign(item, enhanced);
        localStorage.setItem('autopilot_queue', JSON.stringify(socialQueue));
        renderQueue();
      });
      printToTerminal(`[Autopilot] Queued video outline: "${item.title}" for YouTube.`, 'output-success');
      printToOverviewLogs(`Video storyboard queued: '${item.title}'`, 'info');

      // Navigate to autopilot tab
      document.getElementById('navAutopilot').click();

      // Trigger auto-posting simulator
      triggerAutoPublishSimulation(item);
    });
  }

  // Message listener to capture popup callbacks
  window.addEventListener('message', (event) => {
    if (event.data.event === 'facebook-connected') {
      connectedPlatforms.fb = true;
      connectedPlatforms.fbUserId = event.data.userId || fbUsername;
      connectedPlatforms.fbDetails = { type: 'page', name: event.data.name, pageId: event.data.pageId || null };
      connectedPlatforms.fbStartAction = event.data.startAction || 'now';
      connectedPlatforms.fbSchedule = event.data.schedule || null;
      localStorage.setItem('autopilot_conns', JSON.stringify(connectedPlatforms));
      updatePlatformUI('fb');
      renderFbPagePanel();
      const scheduleMsg = event.data.startAction === 'schedule' && event.data.schedule
        ? ` (scheduled for ${event.data.schedule.date} at ${event.data.schedule.time})`
        : ' (starting now)';
      printToTerminal(`[Autopilot] Connected to Facebook Page: ${event.data.name}${scheduleMsg}`, 'output-success');
      // If scheduled, save it
      if (event.data.startAction === 'schedule' && event.data.schedule) {
        localStorage.setItem('autopilot_fb_schedule', JSON.stringify(event.data.schedule));
      } else {
        localStorage.removeItem('autopilot_fb_schedule');
      }
    } else if (event.data.event === 'google-connected') {
      connectedPlatforms.yt = true;
      connectedPlatforms.ytDetails = { channel: event.data.channelName, email: event.data.email };
      localStorage.setItem('autopilot_conns', JSON.stringify(connectedPlatforms));
      updatePlatformUI('yt');
      printToTerminal(`[Autopilot] Connected to YouTube: ${event.data.channelName} (${event.data.email})`, 'output-success');
    }
  });

  // Load persisted FB pages from localStorage
  restoreFbPages();
  renderFbPagePanel();
}

// ── FB Page Management ─────────────────────────────────────────
let fbPages = [];
const FB_PAGES_KEY = 'autopilot_fb_pages';

function restoreFbPages() {
  try {
    const saved = localStorage.getItem(FB_PAGES_KEY);
    fbPages = saved ? JSON.parse(saved) : [];
  } catch { fbPages = []; }
}

function saveFbPages() {
  localStorage.setItem(FB_PAGES_KEY, JSON.stringify(fbPages));
}

function renderFbPagePanel() {
  const container = document.getElementById('fbPagePanel');
  if (!container) return;
  const details = connectedPlatforms.fbDetails;
  if (!connectedPlatforms.fb || !details) {
    container.innerHTML = '';
    return;
  }
  let html = `<div class="fb-connected-info">`;
  html += `<div class="fb-user-row"><span class="fb-user-icon">📄</span><div><strong>${details.name}</strong><span>Facebook Page</span></div></div>`;

  // Show schedule status
  const schedule = connectedPlatforms.fbSchedule;
  if (schedule) {
    html += `<div class="fb-schedule-info">📅 Scheduled to start: <strong>${schedule.date} at ${schedule.time}</strong></div>`;
  } else if (connectedPlatforms.fbStartAction === 'now') {
    html += `<div class="fb-schedule-info" style="color:var(--success)">🚀 Automation active — posting now</div>`;
  }

  html += `<div class="fb-pages-manage">`;
  html += `<div class="fb-pages-list">`;
  fbPages.forEach(p => {
    const active = p.id === details.pageId;
    html += `<div class="fb-page-item ${active ? 'active' : ''}" onclick="switchFbPage('${p.id}')"><span>${active ? '✓' : '○'}</span><span>${p.name}</span></div>`;
  });
  html += `</div>`;
  html += `<button class="btn-secondary btn-sm" onclick="openFbLogin()">+ Switch Facebook Page</button>`;
  html += `</div>`;
  html += `<button class="btn-secondary btn-sm fb-disconnect" onclick="toggleConnection('fb', document.getElementById('btnConnectFb'), document.getElementById('statusFb'))">Disconnect</button>`;
  html += `</div>`;
  container.innerHTML = html;
}

function switchFbPage(pageId) {
  const page = fbPages.find(p => p.id === pageId);
  if (!page) return;
  connectedPlatforms.fbDetails.pageId = pageId;
  connectedPlatforms.fbDetails.name = page.name;
  localStorage.setItem('autopilot_conns', JSON.stringify(connectedPlatforms));
  updatePlatformUI('fb');
  renderFbPagePanel();
  printToTerminal(`[Autopilot] Switched to Facebook Page: ${page.name}`, 'output-info');
}

window.openFbLogin = function() {
  if (!requireSignedIn('connect Facebook')) return;
  window.open('/api/facebook/login', 'Facebook Auth', 'width=600,height=700,resizable=yes');
};

async function toggleConnection(platform, btnEl, statusEl) {
  if (!connectedPlatforms[platform] && !requireSignedIn(platform === 'fb' ? 'connect Facebook' : 'connect YouTube')) return;
  if (connectedPlatforms[platform]) {
    // Disconnect
    connectedPlatforms[platform] = false;
    delete connectedPlatforms[platform + 'Details'];
    localStorage.setItem('autopilot_conns', JSON.stringify(connectedPlatforms));
    updatePlatformUI(platform);
    printToTerminal(`[Autopilot] Disconnected from platform: ${platform === 'fb' ? 'Facebook' : 'YouTube'}`, 'output-info');
  } else {
    // Open OAuth Popup window
    if (platform === 'fb') {
      window.open('/api/facebook/login', 'Facebook Auth', 'width=600,height=700,resizable=yes');
    } else {
      window.open('/api/youtube/login', 'Google Auth', 'width=600,height=700,resizable=yes');
    }
  }
}

function updatePlatformUI(platform) {
  const isConnected = connectedPlatforms[platform];
  const btn = platform === 'fb' ? btnConnectFb : btnConnectYt;
  const status = platform === 'fb' ? statusFb : statusYt;
  const info = platform === 'fb' ? document.getElementById('infoFb') : document.getElementById('infoYt');
  const panel = platform === 'fb' ? document.getElementById('fbPagePanel') : null;

  if (!btn || !status) return;

  btn.disabled = false;
  if (isConnected) {
    status.textContent = "Connected";
    status.className = "status-badge status-connected";
    btn.textContent = "Disconnect";
    btn.className = "btn-secondary btn-sm";
    
    if (platform === 'fb') {
      const details = connectedPlatforms.fbDetails || { name: 'My Profile', type: 'profile' };
      info.textContent = `Connected as: ${details.name} (${details.type === 'page' ? 'Page' : 'Profile'})`;
      if (panel) { panel.classList.remove('hidden'); renderFbPagePanel(); }
    } else {
      const details = connectedPlatforms.ytDetails || { channel: (userProfile?.name || 'User') + "'s Tech Reviews", email: '' };
      info.textContent = `Active Channel: ${details.channel} (${details.email || 'linked'}). Auto-publishing active.`;
    }
  } else {
    status.textContent = "Disconnected";
    status.className = "status-badge status-disconnected";
    btn.textContent = platform === 'fb' ? "Connect Facebook Page" : "Connect Channel";
    btn.className = "btn-primary btn-sm";
    if (info) {
      info.textContent = platform === 'fb' ? "Connect your Facebook Page to automate real page posts and image publishing." : "Connect your channel to schedule shorts and story outlines.";
    }
    if (panel) panel.classList.add('hidden');
  }
}

function renderQueue() {
  if (!autopilotQueueList) return;
  autopilotQueueList.innerHTML = '';

  if (socialQueue.length === 0) {
    if (queueEmptyState) queueEmptyState.style.display = 'flex';
    return;
  }

  if (queueEmptyState) queueEmptyState.style.display = 'none';

  socialQueue.forEach(item => {
    const card = document.createElement('div');
    card.className = 'queue-item-card';
    card.id = `q-${item.id}`;

    const isFb = item.type === 'fb';
    
    // Thumbnail logic
    let thumbnailHtml = isFb ? '📷' : '🎬';
    if (item.media && !item.media.includes('undefined') && item.media !== '') {
      thumbnailHtml = `<img src="${item.media}" alt="thumbnail" onerror="this.style.display='none';this.parentNode.innerHTML='${isFb ? '📷' : '🎬'}'" style="background:rgba(139,92,246,0.1);">`;
    }

    const hashtagHtml = item.hashtags && item.hashtags.length
      ? `<div class="queue-item-hashtags">${item.hashtags.map(h => `<span class="hashtag-pill">${h}</span>`).join('')}</div>`
      : '';
    const statusHtml = item.publishStatus === 'failed'
      ? `<div class="queue-item-error">Last publish failed: ${item.lastError || 'Unknown error'}</div>`
      : item.publishStatus === 'publishing'
        ? `<div class="queue-item-info">Publishing now...</div>`
        : '';
    const retryButtonHtml = item.publishStatus === 'failed'
      ? `<button class="btn-queue-action retry" onclick="retryQueueItem(${item.id})" title="Retry publish">Retry</button>`
      : '';
    const publishNowButtonHtml = item.publishStatus === 'publishing'
      ? `<button class="btn-queue-action publish" disabled title="Publishing in progress">Publishing...</button>`
      : `<button class="btn-queue-action publish" onclick="publishQueueItemNow(${item.id})" title="Publish now">Publish Now</button>`;

    card.innerHTML = `
      <div class="queue-item-left">
        <div class="queue-item-thumbnail">${thumbnailHtml}</div>
        <div class="queue-item-details">
          <h5>${item.title}</h5>
          <div class="queue-item-meta">
            <span class="queue-platform-badge badge-${item.type}">${isFb ? 'Facebook' : 'YouTube'}</span>
            <span class="queue-item-time">${item.time}</span>
          </div>
          ${hashtagHtml}
          ${statusHtml}
        </div>
      </div>
      <div class="queue-item-actions">
        ${publishNowButtonHtml}
        ${retryButtonHtml}
        <button class="btn-remove-queue" onclick="removeFromSocialQueue(${item.id})" title="Remove from queue">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
      </div>
    `;
    autopilotQueueList.appendChild(card);
  });
}

window.removeFromSocialQueue = function(id) {
  if (!requireSignedIn('manage queue')) return;
  socialQueue = socialQueue.filter(item => item.id !== id);
  localStorage.setItem('autopilot_queue', JSON.stringify(socialQueue));
  renderQueue();
  printToTerminal(`[Autopilot] Removed post item from queue.`, 'output-info');
};

window.retryQueueItem = async function(id) {
  if (!requireSignedIn('retry publishing')) return;
  const item = socialQueue.find(entry => entry.id === id);
  if (!item) return;
  item.publishStatus = 'publishing';
  item.lastError = '';
  localStorage.setItem('autopilot_queue', JSON.stringify(socialQueue));
  renderQueue();
  printToTerminal(`[Autopilot] Retrying publish for "${item.title}"...`, 'output-info');

  const result = await publishQueueItem(item, { removeOnSuccess: true, delayMs: 0 });
  if (!result.ok) {
    item.publishStatus = 'failed';
    item.lastError = result.error || 'Publish failed';
    localStorage.setItem('autopilot_queue', JSON.stringify(socialQueue));
    renderQueue();
    return;
  }
};

window.publishQueueItemNow = async function(id) {
  if (!requireSignedIn('publish now')) return;
  const item = socialQueue.find(entry => entry.id === id);
  if (!item) return;
  if (item.publishStatus === 'publishing') return;
  printToTerminal(`[Autopilot] Manual publish started for "${item.title}"...`, 'output-info');
  const result = await publishQueueItem(item, { removeOnSuccess: true, delayMs: 0 });
  if (!result.ok) {
    item.publishStatus = 'failed';
    item.lastError = result.error || 'Publish failed';
    localStorage.setItem('autopilot_queue', JSON.stringify(socialQueue));
    renderQueue();
  }
};

async function autoHashtagAndSeo(item) {
  if (!chkAutoHashtag || !chkAutoHashtag.checked) return item;
  const prompt = item.caption || item.title;
  if (!prompt) return item;

  printToTerminal(`[Auto Hashtag] Generating hashtags & SEO for "${item.title}"...`, 'output-info');
  try {
    const isGemini = document.getElementById('toggleAIMode')?.checked;
    const mode = isGemini ? 'gemini' : 'local';
    const platform = item.type === 'yt' ? 'youtube' : 'facebook';
    const res = await fetch('/api/ai/hashtags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: prompt, platform })
    });
    const data = await res.json();
    if (data.hashtags) {
      item.hashtags = Array.isArray(data.hashtags) ? data.hashtags : data.hashtags.split(',').map(h => h.trim()).filter(Boolean);
    }
    if (data.seoTitles && data.seoTitles.length) {
      item.seoTitle = Array.isArray(data.seoTitles) ? data.seoTitles[0] : data.seoTitles;
    }
    if (data.metaDescription) item.seoDescription = data.metaDescription;
    if (item.hashtags && item.hashtags.length) {
      printToTerminal(`[Auto Hashtag] ✅ ${item.hashtags.length} hashtags generated for "${item.title}"`, 'output-success');
    }
  } catch (e) {
    printToTerminal(`[Auto Hashtag] Error: ${e.message}`, 'output-error');
  }
  return item;
}

async function publishQueueItem(item, options = {}) {
  const { removeOnSuccess = true, delayMs = null } = options;
  if (!item) return { ok: false, error: 'Queue item missing' };
  if (!userProfile) return { ok: false, error: 'Authentication required' };

  item.publishStatus = 'publishing';
  item.lastError = '';
  localStorage.setItem('autopilot_queue', JSON.stringify(socialQueue));
  renderQueue();

  const isFb = item.type === 'fb';
  const platformLabel = isFb ? 'Facebook' : 'YouTube';

  if (delayMs && delayMs > 0) {
    printToTerminal(`[Autopilot] Waiting ${Math.round(delayMs / 1000)}s before publishing to ${platformLabel}...`, 'output-info');
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }

  const index = socialQueue.findIndex(q => q.id === item.id);
  if (index === -1) return { ok: false, error: 'Queue item no longer exists' };

  if (isFb) {
    try {
      const res = await fetch('/api/facebook/post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: item.caption || item.title })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        const error = data.error || 'Facebook publish failed';
        item.publishStatus = 'failed';
        item.lastError = error;
        localStorage.setItem('autopilot_queue', JSON.stringify(socialQueue));
        renderQueue();
        printToTerminal(`[Facebook API] ❌ ${error}`, 'output-error');
        printToTerminal('[Autopilot] Facebook publish failed. Queue item kept for retry.', 'output-warning');
        return { ok: false, error };
      }
      printToTerminal(`[Facebook API] ✅ Real post published! ID: ${data.facebookPostId}`, 'output-success');
    } catch (e) {
      item.publishStatus = 'failed';
      item.lastError = e.message;
      localStorage.setItem('autopilot_queue', JSON.stringify(socialQueue));
      renderQueue();
      printToTerminal(`[Facebook API] Error: ${e.message}`, 'output-error');
      printToTerminal('[Autopilot] Facebook publish failed. Queue item kept for retry.', 'output-warning');
      return { ok: false, error: e.message };
    }
  } else {
    if (!item.uploadRef || !item.uploadRef.path) {
      const error = 'YouTube upload requires a prepared video file. Add a real video first.';
      item.publishStatus = 'failed';
      item.lastError = error;
      localStorage.setItem('autopilot_queue', JSON.stringify(socialQueue));
      renderQueue();
      printToTerminal(`[YouTube API] ❌ ${error}`, 'output-error');
      printToTerminal('[Autopilot] YouTube publish failed. Queue item kept for retry.', 'output-warning');
      return { ok: false, error };
    }

    try {
      const res = await fetch('/api/youtube/post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: item.title,
          description: item.caption || '',
          uploadRef: item.uploadRef || null,
          privacyStatus: 'private'
        })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        const error = data.error || 'YouTube publish failed';
        item.publishStatus = 'failed';
        item.lastError = error;
        localStorage.setItem('autopilot_queue', JSON.stringify(socialQueue));
        renderQueue();
        printToTerminal(`[YouTube API] ❌ ${error}`, 'output-error');
        printToTerminal('[Autopilot] YouTube publish failed. Queue item kept for retry.', 'output-warning');
        return { ok: false, error };
      }
      printToTerminal(`[YouTube API] ✅ Real YouTube video uploaded successfully${data.youtubeVideoId ? `! Video ID: ${data.youtubeVideoId}` : '!'}`, 'output-success');
    } catch (e) {
      item.publishStatus = 'failed';
      item.lastError = e.message;
      localStorage.setItem('autopilot_queue', JSON.stringify(socialQueue));
      renderQueue();
      printToTerminal(`[YouTube API] Error: ${e.message}`, 'output-error');
      printToTerminal('[Autopilot] YouTube publish failed. Queue item kept for retry.', 'output-warning');
      return { ok: false, error: e.message };
    }
  }

  item.publishStatus = 'ready';
  item.lastError = '';

  if (removeOnSuccess) {
    socialQueue.splice(index, 1);
    localStorage.setItem('autopilot_queue', JSON.stringify(socialQueue));
    renderQueue();
  } else {
    localStorage.setItem('autopilot_queue', JSON.stringify(socialQueue));
    renderQueue();
  }

  printToOverviewLogs(`Queue Item Published: '${item.title}' (real)`, 'success');
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    new Notification('Prime Social Autopilot', {
      body: `✅ Real post published: "${item.title}"`
    });
  }

  return { ok: true };
}

function triggerAutoPublishSimulation(item) {
  if (!chkAutoPublish || !chkAutoPublish.checked) return;

  const isFb = item.type === 'fb';
  printToTerminal(`[Autopilot] Publishing "${item.title}" to ${isFb ? 'Facebook' : 'YouTube'}...`, 'output-info');

  const delay = 3000 + Math.random() * 4000;
  publishQueueItem(item, { removeOnSuccess: true, delayMs: delay });
}

// ============================================================
// SCHEDULE CONFIG STATE
// ============================================================
let postSchedule = {
  frequency: '2days',
  postsPerDay: 5,
  postTimes: ['12:00'],
  enabled: false
};

function generatePostTimes(hour, count) {
  const times = [];
  for (let i = 0; i < count; i++) {
    const totalMin = (hour * 60) + Math.round((i * 60) / count);
    const h = Math.floor(totalMin / 60) % 24;
    const m = totalMin % 60;
    times.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
  }
  return times;
}

function initScheduleConfig() {
  // Load saved schedule
  const saved = localStorage.getItem('autopilot_schedule');
  if (saved) {
    try {
      postSchedule = JSON.parse(saved);
    } catch {}
  }

  const freqEl = document.getElementById('scheduleFrequency');
  const postsVal = document.getElementById('postsPerDayValue');
  const statusEl = document.getElementById('scheduleStatus');
  const hourEl = document.getElementById('scheduleStartHour');
  const genDisplay = document.getElementById('generatedTimesDisplay');

  function rebuildTimes() {
    const hour = parseInt(hourEl ? hourEl.value : 12, 10);
    const count = postSchedule.postsPerDay;
    postSchedule.postTimes = generatePostTimes(hour, count);
    if (genDisplay) {
      genDisplay.textContent = postSchedule.postTimes.join(', ');
    }
    saveSchedule();
    updateScheduleStatus();
  }

  if (freqEl) {
    freqEl.value = postSchedule.frequency;
    freqEl.addEventListener('change', () => {
      postSchedule.frequency = freqEl.value;
      saveSchedule();
      updateScheduleStatus();
      printToTerminal(`[Schedule] Post frequency set to: ${freqEl.options[freqEl.selectedIndex].text}`, 'output-info');
    });
  }

  if (hourEl) {
    // Restore saved start hour from first saved post time
    const savedHour = parseInt(postSchedule.postTimes[0]?.split(':')[0], 10);
    if (!isNaN(savedHour) && savedHour >= 0 && savedHour <= 23) {
      hourEl.value = savedHour;
    }
    hourEl.addEventListener('change', rebuildTimes);
  }

  // Post count buttons
  const minusBtn = document.getElementById('postsPerDayMinus');
  const plusBtn = document.getElementById('postsPerDayPlus');
  if (minusBtn) {
    minusBtn.addEventListener('click', () => {
      if (postSchedule.postsPerDay > 1) {
        postSchedule.postsPerDay -= 1;
        postsVal.textContent = postSchedule.postsPerDay;
        rebuildTimes();
      }
    });
  }
  if (plusBtn) {
    plusBtn.addEventListener('click', () => {
      if (postSchedule.postsPerDay < 20) {
        postSchedule.postsPerDay += 1;
        postsVal.textContent = postSchedule.postsPerDay;
        rebuildTimes();
      }
    });
  }

  // Initial generation
  if (hourEl) rebuildTimes();
  else updateScheduleStatus();
}

function saveSchedule() {
  postSchedule.enabled = !!(document.getElementById('chkAutoPublish') || {}).checked;
  localStorage.setItem('autopilot_schedule', JSON.stringify(postSchedule));
}

function updateScheduleStatus() {
  const statusEl = document.getElementById('scheduleStatus');
  if (!statusEl) return;

  const enabled = !!(document.getElementById('chkAutoPublish') || {}).checked;
  postSchedule.enabled = enabled;

  if (!enabled) {
    statusEl.innerHTML = '⏸️ Paused — Enable Autopilot to start';
    return;
  }

  const freqText = {
    daily: 'Every Day',
    '2days': 'Every 2 Days',
    '3days': 'Every 3 Days',
    weekly: 'Once a Week'
  }[postSchedule.frequency] || 'Custom';

  const times = postSchedule.postTimes.join(', ');
  statusEl.innerHTML = `✅ Active — ${freqText}, ${postSchedule.postsPerDay} post(s) at ${times}`;
}

// ============================================================
// MANUAL UPLOAD
// ============================================================
let uploadedFile = null;
let stagedUploadRef = null;
let currentVideoPreviewUrl = '';
let activeUploadRequest = null;
const LARGE_VIDEO_PREVIEW_THRESHOLD = 100 * 1024 * 1024;

function initManualUpload() {
  const dropzone = document.getElementById('uploadDropzone');
  const fileInput = document.getElementById('fileInput');
  const uploadPreview = document.getElementById('uploadPreview');
  const previewImage = document.getElementById('previewImage');
  const previewVideo = document.getElementById('previewVideo');
  const removeBtn = document.getElementById('uploadRemoveBtn');
  const uploadText = document.getElementById('uploadText');
  const addBtn = document.getElementById('btnAddManualPost');
  const cancelBtn = document.getElementById('uploadCancelBtn');

  if (!dropzone || !fileInput) return;

  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      if (activeUploadRequest) {
        activeUploadRequest.abort();
        printToTerminal('[YouTube Upload] Upload cancelled by user.', 'output-warning');
      }
    });
  }

  window.addEventListener('beforeunload', () => {
    releaseCurrentVideoPreview();
    cleanupStagedUpload(true);
  });

  // Click to upload
  dropzone.addEventListener('click', () => fileInput.click());

  // File selected
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    handleFile(file);
  });

  // Drag & drop
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });
  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('dragover');
  });
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });

  // Remove
  if (removeBtn) {
    removeBtn.addEventListener('click', async () => {
      await clearUpload();
    });
  }

  // Add to queue
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      addManualPostToQueue();
    });
  }
}

function setUploadProgressState(visible, percent = 0, label = 'Preparing upload...') {
  const wrap = document.getElementById('uploadProgressWrap');
  const fill = document.getElementById('uploadProgressFill');
  const text = document.getElementById('uploadProgressPercent');
  const status = document.getElementById('uploadProgressLabel');
  if (wrap) wrap.classList.toggle('hidden', !visible);
  if (fill) fill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  if (text) text.textContent = `${Math.round(Math.max(0, Math.min(100, percent)))}%`;
  if (status) status.textContent = label;
}

function releaseCurrentVideoPreview() {
  const previewVideo = document.getElementById('previewVideo');
  if (previewVideo) {
    previewVideo.pause();
    previewVideo.removeAttribute('src');
    previewVideo.load();
  }
  if (currentVideoPreviewUrl) {
    URL.revokeObjectURL(currentVideoPreviewUrl);
    currentVideoPreviewUrl = '';
  }
}

function uploadMediaWithProgress(file) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    activeUploadRequest = xhr;
    const formData = new FormData();
    formData.append('file', file, file.name);

    xhr.open('POST', '/api/uploads/media');
    xhr.responseType = 'json';

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) {
        setUploadProgressState(true, 0, 'Uploading video to local staging...');
        return;
      }
      const percent = (event.loaded / event.total) * 100;
      setUploadProgressState(true, percent, `Uploading video to local staging... ${Math.round(event.loaded / 1024 / 1024)}MB / ${Math.max(1, Math.round(event.total / 1024 / 1024))}MB`);
    };

    xhr.onload = () => {
      activeUploadRequest = null;
      const data = xhr.response || {};
      if (xhr.status >= 200 && xhr.status < 300 && data.ok) {
        setUploadProgressState(true, 100, 'Upload prepared successfully');
        resolve(data.upload);
        return;
      }
      reject(new Error(data.error || 'Upload preparation failed'));
    };

    xhr.onerror = () => {
      activeUploadRequest = null;
      reject(new Error('Network error during upload'));
    };

    xhr.onabort = () => {
      activeUploadRequest = null;
      setUploadProgressState(false, 0, 'Preparing upload...');
      reject(new Error('Upload cancelled'));
    };

    xhr.send(formData);
  });
}

async function cleanupStagedUpload(useBeacon = false) {
  if (!stagedUploadRef || !stagedUploadRef.path) return;
  const pathToDelete = stagedUploadRef.path;
  stagedUploadRef = null;

  try {
    const payload = JSON.stringify({ path: pathToDelete });
    if (useBeacon && navigator.sendBeacon) {
      navigator.sendBeacon('/api/uploads/media', new Blob([payload], { type: 'application/json' }));
      return;
    }
    await fetch('/api/uploads/media', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
  } catch {}
}

async function handleFile(file) {
  const isImage = file.type.startsWith('image/');
  const isVideo = file.type.startsWith('video/');
  if (!isImage && !isVideo) {
    alert('Please upload an image or video file.');
    return;
  }

  await cleanupStagedUpload();
  releaseCurrentVideoPreview();
  uploadedFile = file;
  const uploadPreview = document.getElementById('uploadPreview');
  const previewImage = document.getElementById('previewImage');
  const previewVideo = document.getElementById('previewVideo');
  const dropzone = document.getElementById('uploadDropzone');
  const uploadText = document.getElementById('uploadText');

  dropzone.classList.add('hidden');
  uploadPreview.classList.remove('hidden');

  if (isImage) {
    previewImage.classList.remove('hidden');
    previewVideo.classList.add('hidden');
    const reader = new FileReader();
    reader.onload = (e) => { previewImage.src = e.target.result; };
    reader.readAsDataURL(file);
    uploadText.textContent = file.name;
  } else {
    previewVideo.classList.remove('hidden');
    previewImage.classList.add('hidden');
    const isLargeVideo = file.size > LARGE_VIDEO_PREVIEW_THRESHOLD;
    if (isLargeVideo) {
      previewVideo.setAttribute('hidden', 'hidden');
      uploadText.textContent = `${file.name} — large video selected, preview disabled to reduce memory usage`;
      printToTerminal('[Upload] Large video detected. Live preview disabled to reduce browser memory pressure.', 'output-info');
    } else {
      previewVideo.removeAttribute('hidden');
      currentVideoPreviewUrl = URL.createObjectURL(file);
      previewVideo.src = currentVideoPreviewUrl;
      uploadText.textContent = file.name;
    }
  }
}

async function clearUpload() {
  if (activeUploadRequest) {
    activeUploadRequest.abort();
    activeUploadRequest = null;
  }
  uploadedFile = null;
  await cleanupStagedUpload();
  releaseCurrentVideoPreview();
  const fileInput = document.getElementById('fileInput');
  const uploadPreview = document.getElementById('uploadPreview');
  const dropzone = document.getElementById('uploadDropzone');
  const previewImage = document.getElementById('previewImage');
  const previewVideo = document.getElementById('previewVideo');
  const uploadText = document.getElementById('uploadText');

  fileInput.value = '';
  uploadPreview.classList.add('hidden');
  dropzone.classList.remove('hidden');
  previewImage.src = '';
  previewVideo.setAttribute('hidden', 'hidden');
  uploadText.textContent = 'Click to upload photo or video';
  setUploadProgressState(false, 0, 'Preparing upload...');
}

async function addManualPostToQueue() {
  if (!requireSignedIn('add manual posts')) return;
  const caption = document.getElementById('uploadCaption');
  const platform = document.getElementById('uploadPlatform');
  const platformType = platform ? platform.value : 'fb';

  if (!caption || !caption.value.trim()) {
    alert('Please write a caption for your post!');
    return;
  }

  const platformName = platformType === 'fb' ? 'Facebook' : 'YouTube';
  const connKey = platformType === 'fb' ? 'fb' : 'yt';

  if (!connectedPlatforms[connKey]) {
    alert(`Please connect your ${platformName} first in the section above!`);
    document.getElementById('navAutopilot').click();
    return;
  }

  let mediaType = 'text';
  let mediaSrc = '';
  let uploadRef = null;

  if (uploadedFile) {
    mediaType = uploadedFile.type.startsWith('video/') ? 'video' : 'image';
    if (document.getElementById('previewImage').src) {
      mediaSrc = document.getElementById('previewImage').src;
    } else if (document.getElementById('previewVideo').src) {
      mediaSrc = document.getElementById('previewVideo').src;
    }

    if (platformType === 'yt' && mediaType !== 'video') {
      alert('YouTube real upload requires a video file. Please upload a video.');
      return;
    }

    if (platformType === 'yt' && mediaType === 'video') {
      try {
        printToTerminal('[YouTube Upload] Uploading selected video to local server staging...', 'output-info');
        setUploadProgressState(true, 0, 'Starting upload...');
        uploadRef = await uploadMediaWithProgress(uploadedFile);
        stagedUploadRef = uploadRef;
        printToTerminal(`[YouTube Upload] Video file prepared: ${uploadRef.fileName} (${Math.round((uploadRef.size || 0) / 1024 / 1024)} MB)`, 'output-success');
      } catch (e) {
        setUploadProgressState(false, 0, 'Preparing upload...');
        if (e.message !== 'Upload cancelled') {
          printToTerminal(`[YouTube Upload] ${e.message}`, 'output-error');
          alert('Failed to prepare the video file for YouTube upload.');
        }
        return;
      }
    }
  }

  const item = {
    id: Date.now() + Math.floor(Math.random() * 1000),
    title: caption.value.trim().slice(0, 80) + (caption.value.trim().length > 80 ? '...' : ''),
    caption: caption.value.trim(),
    type: platformType,
    time: new Date().toLocaleString(),
    media: mediaSrc,
    mediaType: mediaType,
    uploadRef,
    source: 'manual-upload',
    createdAt: new Date().toISOString()
  };

  socialQueue.unshift(item);
  localStorage.setItem('autopilot_queue', JSON.stringify(socialQueue));
  renderQueue();
  stagedUploadRef = null;
  setUploadProgressState(false, 0, 'Preparing upload...');
  await clearUpload();
  caption.value = '';

  printToTerminal(`[Upload] Queued "${item.title}" to ${platformName}`, 'output-success');
  printToOverviewLogs(`Manual post queued: '${item.title}'`, 'success');

  autoHashtagAndSeo(item).then(enhanced => {
    Object.assign(item, enhanced);
    localStorage.setItem('autopilot_queue', JSON.stringify(socialQueue));
    renderQueue();
  });

  triggerAutoPublishSimulation(item);
}

// ============================================================
// AUTO-POST SCHEDULER
// ============================================================
let autoPostTimer = null;

function startAutoPostScheduler() {
  if (autoPostTimer) clearInterval(autoPostTimer);
  autoPostTimer = setInterval(checkAutoPost, 60000); // Check every minute
}

async function checkAutoPost() {
  const masterOn = localStorage.getItem('master_automation') === 'true';
  if (!masterOn) return;

  const publishEnabled = !!(document.getElementById('chkAutoPublish') || {}).checked;
  if (!publishEnabled) return;
  if (socialQueue.length === 0) return;

  const saved = localStorage.getItem('autopilot_schedule');
  if (!saved) return;
  const schedule = JSON.parse(saved);
  if (!schedule.enabled) return;

  const now = new Date();

  const matchedTime = schedule.postTimes.find((t) => {
    const [h, m] = t.split(':');
    const targetMin = parseInt(h) * 60 + parseInt(m);
    const currentMin = now.getHours() * 60 + now.getMinutes();
    const diff = Math.abs(currentMin - targetMin);
    return diff <= 15;
  });

  if (!matchedTime) return;

  const lastPostKey = `autopilot_last_post_${schedule.frequency}`;
  const lastPostStr = localStorage.getItem(lastPostKey);
  const daysMap = { daily: 1, '2days': 2, '3days': 3, weekly: 7 };
  const intervalDays = daysMap[schedule.frequency] || 1;

  if (lastPostStr) {
    const lastPost = new Date(lastPostStr);
    const diffDays = (now - lastPost) / (1000 * 60 * 60 * 24);
    if (diffDays < intervalDays) return;
  }

  const todayKey = `autopilot_posts_today_${now.toDateString()}`;
  const todayCount = parseInt(localStorage.getItem(todayKey) || '0', 10);
  if (todayCount >= schedule.postsPerDay) return;

  const availablePlatforms = [];
  if (connectedPlatforms.fb) availablePlatforms.push('fb');
  if (connectedPlatforms.yt) availablePlatforms.push('yt');
  if (!availablePlatforms.length) return;

  const postIndex = socialQueue.findIndex((item) => availablePlatforms.includes(item.type));
  if (postIndex === -1) return;

  const item = socialQueue[postIndex];
  const platformLabel = item.type === 'fb' ? 'Facebook' : 'YouTube';

  const delay = humanizer.humanDelay(3000, 7000);
  printToTerminal(`[Autopilot AUTO] Scheduled real publish matched for ${platformLabel}.`, 'output-info');
  printToTerminal(`[Humanizer] Applying ${Math.round(delay / 1000)}s delay before real publish...`, 'output-info');

  const result = await publishQueueItem(item, { removeOnSuccess: true, delayMs: delay });
  if (!result.ok) return;

  localStorage.setItem(lastPostKey, now.toISOString());
  localStorage.setItem(todayKey, String(todayCount + 1));
  printToTerminal(`[Autopilot AUTO] ✅ Real publish completed to ${platformLabel} (${todayCount + 1}/${schedule.postsPerDay})`, 'output-success');
}

// Request notification permission
if ('Notification' in window && Notification.permission === 'default') {
  Notification.requestPermission();
}

// ============================================================
// MASTER TOGGLE — Facebook & YouTube Automation
// ============================================================

function initMasterToggle() {
  const toggle = document.getElementById('masterAutoToggle');
  const bar = document.getElementById('masterToggleBar');
  const label = document.getElementById('masterToggleLabel');
  const status = document.getElementById('masterToggleStatus');
  const icon = document.getElementById('masterToggleIcon');

  if (!toggle) return;

  // Load saved state
  const saved = localStorage.getItem('master_automation') === 'true';
  toggle.checked = saved;
  updateMasterUI(saved);

  toggle.addEventListener('change', () => {
    const enabled = toggle.checked;
    localStorage.setItem('master_automation', enabled);

    // Sync with autopilot publish toggle
    const chkPublish = document.getElementById('chkAutoPublish');
    if (chkPublish) chkPublish.checked = enabled;

    // Sync with auto-generate toggle
    const chkGen = document.getElementById('chkAutoGenerate');
    if (chkGen) chkGen.checked = enabled;

    // Sync schedule
    const schedule = JSON.parse(localStorage.getItem('autopilot_schedule') || '{}');
    schedule.enabled = enabled;
    localStorage.setItem('autopilot_schedule', JSON.stringify(schedule));

    // Save toggles
    localStorage.setItem('autopilot_publish', enabled);
    localStorage.setItem('autopilot_generate', enabled);

    updateMasterUI(enabled);
    updateScheduleStatus();

    printToTerminal(`[Master] Facebook & YouTube Automation ${enabled ? '✅ ACTIVATED' : '⏸️ PAUSED'}`, enabled ? 'output-success' : 'output-info');

    if (enabled) {
      // Trigger immediate check
      setTimeout(checkAutoPost, 5000);
    }
  });
}

function updateMasterUI(enabled) {
  const bar = document.getElementById('masterToggleBar');
  const label = document.getElementById('masterToggleLabel');
  const status = document.getElementById('masterToggleStatus');
  const icon = document.getElementById('masterToggleIcon');

  if (!bar) return;
  bar.classList.toggle('active', enabled);

  if (label) label.textContent = enabled ? '✅ Facebook & YouTube Automation — LIVE' : 'Facebook & YouTube Automation';
  if (status) {
    status.textContent = enabled
      ? 'Scheduled real publishing is active for connected platforms.'
      : 'Tap to start scheduled real publishing for connected platforms.';
  }
  if (icon) icon.textContent = enabled ? '🛡️' : '🤖';
}

// Call on load
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(initMasterToggle, 200);
});
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  setTimeout(initMasterToggle, 300);
}

// ============================================================
// Publish Timing & Content Variation Helpers
// ============================================================

const humanizer = {
  // Generate short publish delay (ms)
  humanDelay: function(min = 3000, max = 7000) {
    return Math.floor(Math.random() * (max - min)) + min;
  },

  // Add random jitter to post time (±minutes)
  jitterTime: function(timeStr, minutes = 15) {
    const [h, m] = timeStr.split(':').map(Number);
    const jitter = Math.floor(Math.random() * minutes * 2) - minutes;
    let newM = m + jitter;
    let newH = h;
    if (newM >= 60) { newM -= 60; newH += 1; }
    if (newM < 0) { newM += 60; newH -= 1; }
    if (newH < 0) newH = 23;
    if (newH > 23) newH = 0;
    return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
  },

  // Apply lightweight local content variation
  rewriteContent: function(text) {
    if (!text) return text;
    const prefixes = [
      '🔥 ', '🚀 ', '💡 ', '⚡ ', '📌 ', '🎯 ', '✨ ', '',
      '', '', '', ''
    ];
    const suffixes = [
      '\n\nWhat do you think? Drop a comment below!',
      '\n\nShare this with someone who needs it.',
      '\n\nSave this for later!',
      '\n\nTry this strategy today.',
      '\n\nWhich tip helped you the most?',
      '',
      '',
      ''
    ];
    const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
    const suffix = suffixes[Math.floor(Math.random() * suffixes.length)];
    return prefix + text + suffix;
  },

  // Generate unique hashtags
  generateTags: function(topic) {
    const tags = {
      'ai': ['#AI', '#ArtificialIntelligence', '#Automation', '#Tech', '#Future'],
      'automation': ['#Automation', '#NoCode', '#Workflow', '#Productivity', '#AI'],
      'facebook': ['#FacebookMarketing', '#SocialMedia', '#DigitalMarketing', '#Growth', '#Viral'],
      'youtube': ['#YouTube', '#ContentCreator', '#VideoMarketing', '#GrowYourChannel', '#ViralVideo'],
      'saas': ['#SaaS', '#Startup', '#TechBusiness', '#Entrepreneur', '#Innovation'],
      'business': ['#Business', '#GrowthHacking', '#MarketingStrategy', '#LeadGeneration', '#Sales'],
      'default': ['#Automation', '#Productivity', '#Growth', '#AI', '#Tech']
    };

    const lower = (topic || '').toLowerCase();
    for (const [key, tagList] of Object.entries(tags)) {
      if (lower.includes(key)) {
        return tagList.slice(0, 3 + Math.floor(Math.random() * 3)).join(' ');
      }
    }
    return tags.default.slice(0, 3 + Math.floor(Math.random() * 3)).join(' ');
  },

  // Generate local metadata variation
  getUserAgent: function() {
    const agents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/17.2',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/119.0.0.0',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15'
    ];
    return agents[Math.floor(Math.random() * agents.length)];
  },

  // Apply local timing/content variation metadata to a post item
  humanizePost: function(item) {
    if (!item) return item;
    item.caption = this.rewriteContent(item.caption || item.title || '');
    item.tags = this.generateTags(item.title || '');
    item.userAgent = this.getUserAgent();
    item.postedAt = new Date().toISOString();
    item.humanized = true;
    return item;
  }
};

// ============================================================
// Fix Image Error — handle missing assets gracefully
// ============================================================
function fixImageErrors() {
  // Global error handler for missing images
  document.addEventListener('error', (e) => {
    if (e.target.tagName === 'IMG') {
      const img = e.target;
      const src = img.src || '';

      // Check if it's a missing asset
      if (src.includes('image.png') || src.includes('undefined') || src === '' || img.naturalWidth === 0) {
        // Generate a placeholder gradient
        img.style.display = 'none';
        const placeholder = document.createElement('div');
        placeholder.className = 'image-placeholder';
        placeholder.innerHTML = `
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:0.3">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
            <circle cx="8.5" cy="8.5" r="1.5"></circle>
            <polyline points="21 15 16 10 5 21"></polyline>
          </svg>
          <span>AI Generated Asset</span>
        `;
        img.parentNode.insertBefore(placeholder, img.nextSibling);
        console.warn('Image load error handled for:', src);
      }
    }
  }, true);
}

// Fix queue image errors
function fixQueueImageErrors() {
  const observer = new MutationObserver(() => {
    document.querySelectorAll('.queue-item-thumbnail img').forEach((img) => {
      img.addEventListener('error', function() {
        this.style.display = 'none';
        if (!this.parentNode.querySelector('.queue-img-fallback')) {
          const fallback = document.createElement('span');
          fallback.className = 'queue-img-fallback';
          fallback.textContent = this.closest('[class*="fb"]') ? '📷' : '🎬';
          this.parentNode.appendChild(fallback);
        }
      });
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

// Init both
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => { fixImageErrors(); fixQueueImageErrors(); }, 500);
});

// ============================================================
// AI CONTENT PIPELINE (Trending Scripts → Media → Queue)
// ============================================================

async function runContentPipeline() {
  if (!requireSignedIn('run the content pipeline')) return;
  const btn = document.getElementById('btnRunPipeline');
  const output = document.getElementById('pipelineOutput');
  const progress = document.getElementById('pipelineProgress');
  const progressFill = document.getElementById('pipelineProgressFill');
  const progressText = document.getElementById('pipelineProgressText');
  const scriptsContainer = document.getElementById('pipelineScripts');
  const badge = document.getElementById('pipelineBadge');

  if (!btn) return;
  btn.disabled = true;
  btn.textContent = '⏳ Running...';
  output.classList.add('hidden');
  progress.classList.remove('hidden');

  const updateStep = (num, status, text) => {
    const step = document.getElementById(`pipelineStep${num}`);
    const statusEl = document.getElementById(`step${num}Status`);
    if (!step) return;
    step.className = 'pipeline-step ' + status;
    if (statusEl) statusEl.textContent = text || (status === 'running' ? '⏳ In progress...' : status === 'done' ? '✅ Done' : '⏳ Waiting');
  };

  const setProgress = (pct, text) => {
    if (progressFill) progressFill.style.width = pct + '%';
    if (progressText) progressText.textContent = text;
  };

  try {
    // Step 1: Generate Trending Scripts
    updateStep(1, 'running', '⏳ Generating...');
    setProgress(15, 'Connecting to AI engine...');
    printToTerminal('[Pipeline] Step 1: Generating trending scripts...', 'output-info');

    const count = postSchedule.postsPerDay || 5;
    const platform = connectedPlatforms.fb ? 'facebook' : 'youtube';
    const res = await fetch('/api/generate/trending', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: Math.min(count, 10), platform })
    });
    const data = await res.json();
    const scripts = data.scripts || [];

    if (scripts.length === 0) {
      throw new Error('No scripts generated');
    }

    updateStep(1, 'done', `✅ ${scripts.length} scripts`);
    setProgress(40, `${scripts.length} trending scripts generated!`);

    // Render scripts
    scriptsContainer.innerHTML = '';
    scripts.forEach((s) => {
      const el = document.createElement('div');
      el.className = 'pipeline-script-item';
      el.innerHTML = `
        <div class="script-topic">${s.topic}</div>
        <div class="script-hook">${s.hook}</div>
        <div class="script-meta">
          <span class="script-viral">🔥 ${s.viralScore || 85}% viral</span>
          <span class="script-genre">${s.style || 'educational'}</span>
        </div>
      `;
      el.addEventListener('click', () => {
        printToTerminal(`[Pipeline] Script: ${s.topic} — ${s.hook}`, 'output-info');
        if (s.outline) {
          s.outline.forEach((line) => printToTerminal(`  • ${line}`, 'output-info'));
        }
      });
      scriptsContainer.appendChild(el);
    });

    output.classList.remove('hidden');
    if (badge) badge.textContent = `${scripts.length} scripts`;
    printToTerminal(`[Pipeline] Generated ${scripts.length} trending scripts`, 'output-success');

    // Step 2: Create Media Assets
    updateStep(2, 'running', '⏳ Creating...');
    setProgress(55, 'Creating media assets from scripts...');
    printToTerminal('[Pipeline] Step 2: Creating media assets...', 'output-info');

    for (let i = 0; i < scripts.length; i++) {
      const s = scripts[i];
      try {
        await fetch('/api/generate/media', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            topic: s.topic,
            mediaType: 'image',
            style: s.style || 'cyberpunk'
          })
        });
        setProgress(55 + (30 * (i + 1) / scripts.length), `Media ${i + 1}/${scripts.length} created...`);
        printToTerminal(`[Pipeline] Media created for: ${s.topic}`, 'output-success');
      } catch (err) {
        console.error('Media gen error:', err);
      }
    }

    updateStep(2, 'done', `✅ ${scripts.length} assets`);
    setProgress(85, 'All media assets ready!');
    printToTerminal(`[Pipeline] Created ${scripts.length} media assets`, 'output-success');

    // Step 3: Queue for Autopilot
    updateStep(3, 'running', '⏳ Queuing...');
    setProgress(90, 'Queuing for Autopilot...');
    printToTerminal('[Pipeline] Step 3: Queuing for Social Autopilot...', 'output-info');

    const targetPlatform = connectedPlatforms.fb ? 'fb' : 'yt';
    const platformName = targetPlatform === 'fb' ? 'Facebook' : 'YouTube';

    scripts.forEach((s) => {
      const item = {
        id: Date.now() + Math.floor(Math.random() * 100000),
        title: s.topic.slice(0, 80),
        caption: `${s.hook}\n\n${(s.outline || []).join('\n')}`,
        type: targetPlatform,
        time: new Date().toLocaleString(),
        media: '',
        mediaType: 'image',
        source: 'ai-pipeline',
        viralScore: s.viralScore || 85,
        createdAt: new Date().toISOString()
      };
      socialQueue.unshift(item);
      // Auto Hashtag & SEO for each pipeline item
      if (chkAutoHashtag && chkAutoHashtag.checked) {
        autoHashtagAndSeo(item).then(enhanced => {
          Object.assign(item, enhanced);
          localStorage.setItem('autopilot_queue', JSON.stringify(socialQueue));
          renderQueue();
        });
      }
    });

    localStorage.setItem('autopilot_queue', JSON.stringify(socialQueue));
    renderQueue();

    updateStep(3, 'done', `✅ ${scripts.length} queued`);
    setProgress(100, `✅ Pipeline complete! ${scripts.length} items ready for ${platformName}`);
    printToTerminal(`[Pipeline] ✅ Queued ${scripts.length} items to ${platformName} Autopilot`, 'output-success');
    printToOverviewLogs(`AI Pipeline: ${scripts.length} trending contents created & queued`, 'success');

    // Trigger auto-publish if enabled
    if (chkAutoPublish && chkAutoPublish.checked) {
      socialQueue.slice(0, scripts.length).forEach((item) => {
        triggerAutoPublishSimulation(item);
      });
    }

  } catch (err) {
    printToTerminal(`[Pipeline] ❌ Error: ${err.message}`, 'output-error');
    setProgress(0, `❌ Failed: ${err.message}`);
    Object.keys({1:1,2:1,3:1}).forEach((k) => {
      const st = document.getElementById(`step${k}Status`);
      if (st && st.textContent.includes('⏳')) st.textContent = '❌ Failed';
    });
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polygon points="5 3 19 12 5 21 5 3"></polygon>
    </svg> Run Pipeline`;
  }
}

// Bind pipeline button
const pipelineBtn = document.getElementById('btnRunPipeline');
if (pipelineBtn) {
  pipelineBtn.addEventListener('click', runContentPipeline);
}

// ============================================================
// GENERATIVE MEDIA BRIDGE — auto-create from workflow
// ============================================================
// This bridge listens for automation engine social queue items
// and automatically creates media previews for them

async function bridgeGenMediaToAutopilot(scriptTopic, scriptText) {
  // This is called when a workflow with AI Rewrite → Social node runs
  printToTerminal(`[GenMedia Bridge] Creating media for: ${scriptTopic}`, 'output-info');

  try {
    const res = await fetch('/api/generate/media', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topic: scriptTopic,
        mediaType: 'image',
        style: 'cyberpunk'
      })
    });
    const data = await res.json();
    printToTerminal(`[GenMedia Bridge] ✅ Media created: ${data.media?.id}`, 'output-success');
    return data.media;
  } catch (err) {
    printToTerminal(`[GenMedia Bridge] ❌ ${err.message}`, 'output-error');
    return null;
  }
}

// Hook into automation engine run results
const origRunCurrent = window.AutomationEngineUI?.run;
if (window.AutomationEngineUI) {
  const origRun = window.AutomationEngineUI.run;
  window.AutomationEngineUI.run = async function(payload) {
    const run = await origRun.call(this, payload);
    if (run && run.status === 'success') {
      // Check if any social items were created
      const socialSteps = (run.steps || []).filter(s =>
        s.type === 'social.facebook' || s.type === 'social.youtube'
      );
      for (const step of socialSteps) {
        if (step.output?.title) {
          await bridgeGenMediaToAutopilot(step.output.title, step.output.title);
        }
      }
    }
    return run;
  };
}

// Listen for autopilot toggle to update schedule status
if (chkAutoPublish) {
  chkAutoPublish.addEventListener('change', () => {
    saveSchedule();
    updateScheduleStatus();
  });
}

// Override the original toggleConnection to update status on connect
const origToggleConnection = toggleConnection;
toggleConnection = async function(platform, btnEl, statusEl) {
  await origToggleConnection(platform, btnEl, statusEl);
  setTimeout(updateScheduleStatus, 500);
};

// ============================================================
// LEGAL MODAL FUNCTIONS (Terms & Privacy Policy)
// ============================================================
function openLegalModal(tab) {
  const overlay = document.getElementById('legalOverlay');
  if (overlay) {
    overlay.classList.remove('hidden');
    switchLegalTab(tab || 'terms');
  }
}

function closeLegalModal(event, force) {
  const overlay = document.getElementById('legalOverlay');
  const modal = document.getElementById('legalModal');
  if (!overlay) return;
  if (force || (event && event.target === overlay)) {
    overlay.classList.add('hidden');
  }
}

function switchLegalTab(tab) {
  const termsContent = document.getElementById('legalContentTerms');
  const privacyContent = document.getElementById('legalContentPrivacy');
  const tabTerms = document.getElementById('legalTabTerms');
  const tabPrivacy = document.getElementById('legalTabPrivacy');
  if (!termsContent || !privacyContent) return;
  if (tab === 'terms') {
    termsContent.classList.remove('hidden');
    privacyContent.classList.add('hidden');
    tabTerms && tabTerms.classList.add('active');
    tabPrivacy && tabPrivacy.classList.remove('active');
  } else {
    privacyContent.classList.remove('hidden');
    termsContent.classList.add('hidden');
    tabPrivacy && tabPrivacy.classList.add('active');
    tabTerms && tabTerms.classList.remove('active');
  }
}

// Close legal modal on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const overlay = document.getElementById('legalOverlay');
    if (overlay && !overlay.classList.contains('hidden')) {
      overlay.classList.add('hidden');
    }
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   SETTINGS / API INTEGRATIONS — logic
   ═══════════════════════════════════════════════════════════════════════════ */

// All credential field IDs that map to backend keys
const CRED_FIELDS = [
  'geminiApiKey',
  'smtpHost', 'smtpPort', 'smtpUser', 'smtpPass',
  'telegramBotToken', 'telegramChatId',
  'sheetsSpreadsheetId', 'googleServiceAccount',
  'slackWebhookUrl',
  'discordWebhookUrl',
  'notionToken', 'notionDatabaseId',
  'facebookAppId', 'facebookAppSecret', 'facebookPageToken',
  'youtubeClientId', 'youtubeClientSecret', 'youtubeRefreshToken'
];

// Which fields belong to which service (for status dot)
const SERVICE_FIELDS = {
  gemini:       ['geminiApiKey'],
  email:        ['smtpUser', 'smtpPass'],
  telegram:     ['telegramBotToken', 'telegramChatId'],
  googlesheets: ['sheetsSpreadsheetId', 'googleServiceAccount'],
  slack:        ['slackWebhookUrl'],
  discord:      ['discordWebhookUrl'],
  notion:       ['notionToken', 'notionDatabaseId'],
  facebook:     ['facebookAppId', 'facebookAppSecret', 'facebookPageToken'],
  youtube:      ['youtubeClientId', 'youtubeClientSecret', 'youtubeRefreshToken']
};

// ============================================================
// API CONNECTION STATUS CHECKER
// ============================================================
async function checkApiStatus() {
  try {
    const res = await fetch('/api/credentials');
    const data = await res.json();
    const creds = data.credentials || {};

    const apis = [
      { id: 'gemini', key: 'geminiApiKey', label: 'Gemini AI' },
      { id: 'facebook', key: 'facebookPageToken', label: 'Facebook API' },
      { id: 'youtube', key: 'youtubeClientId', label: 'YouTube API' },
      { id: 'smtp', key: 'smtpUser', label: 'Email (SMTP)' },
      { id: 'telegram', key: 'telegramBotToken', label: 'Telegram Bot' },
      { id: 'slack', key: 'slackWebhookUrl', label: 'Slack' },
      { id: 'discord', key: 'discordWebhookUrl', label: 'Discord' },
      { id: 'notion', key: 'notionToken', label: 'Notion' },
      { id: 'sheets', key: 'googleServiceAccount', label: 'Google Sheets' }
    ];

    apis.forEach(api => {
      const dot = document.getElementById('dot-' + api.id);
      const text = document.getElementById('statusText-' + api.id);
      if (!dot || !text) return;

      const connected = creds[api.key] && String(creds[api.key]).trim().length > 5;
      dot.style.background = connected ? '#10b981' : '#ef4444';
      dot.style.boxShadow = connected ? '0 0 8px rgba(16,185,129,0.5)' : '0 0 8px rgba(239,68,68,0.3)';
      text.textContent = connected ? '✅ Connected' : '❌ Not configured';
      text.style.color = connected ? '#10b981' : '#ef4444';
    });
  } catch (err) {
    console.error('[API Status] Failed to check:', err);
  }
}

function markSettingsDirty() {
  if (!_settingsDirty) {
    _settingsDirty = true;
    const bar = document.getElementById('settingsSaveBar');
    if (bar) bar.style.display = 'flex';
  }
}

async function loadCredentials() {
  if (!userProfile) {
    _savedCredKeys = new Set();
    for (const svc of Object.keys(SERVICE_FIELDS)) {
      const dot = document.getElementById(`status-${svc}`);
      if (dot) dot.className = 'settings-status-dot';
    }
    updateSettingsBadge();
    return;
  }
  try {
    const res = await fetch('/api/credentials');
    const data = await res.json();
    _savedCredKeys = new Set(data.keys || []);
    // Update status dots based on which keys exist
    for (const [svc, fields] of Object.entries(SERVICE_FIELDS)) {
      const hasAll = fields.every(f => _savedCredKeys.has(f));
      const dot = document.getElementById(`status-${svc}`);
      if (dot) {
        dot.className = 'settings-status-dot' + (hasAll ? ' connected' : '');
      }
    }
    updateSettingsBadge();
    checkApiStatus();
  } catch (e) {
    console.warn('Could not load credentials:', e);
  }
}

async function saveAllCredentials() {
  if (!requireSignedIn('save API credentials')) return;
  const body = {};
  for (const key of CRED_FIELDS) {
    const el = document.getElementById(`cred-${key}`);
    if (el) body[key] = el.value.trim();
  }
  try {
    const btn = document.getElementById('btnSaveAllCreds');
    if (btn) { btn.textContent = '⏳ Saving…'; btn.disabled = true; }
    const res = await fetch('/api/credentials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (data.ok) {
      _savedCredKeys = new Set(data.savedKeys || []);
      _settingsDirty = false;
      const bar = document.getElementById('settingsSaveBar');
      if (bar) bar.style.display = 'none';
      if (btn) { btn.textContent = '✅ Saved!'; btn.disabled = false; }
      setTimeout(() => { if (btn) btn.textContent = '💾 Save All Changes'; }, 2000);
      updateSettingsBadge();
      // Refresh status dots
      for (const [svc, fields] of Object.entries(SERVICE_FIELDS)) {
        const hasAll = fields.every(f => _savedCredKeys.has(f));
        const dot = document.getElementById(`status-${svc}`);
        if (dot) dot.className = 'settings-status-dot' + (hasAll ? ' connected' : '');
      }
    }
  } catch (e) {
    console.error('Save error:', e);
    const btn = document.getElementById('btnSaveAllCreds');
    if (btn) { btn.textContent = '❌ Error'; btn.disabled = false; }
  }
}

async function testConnection(service) {
  if (!requireSignedIn(`test ${service} connection`)) return;
  const btn = document.getElementById(`test-${service}`);
  const result = document.getElementById(`result-${service}`);
  const dot = document.getElementById(`status-${service}`);
  const card = document.getElementById(`card-${service}`);

  // First save current field values for this service
  const body = {};
  const fields = SERVICE_FIELDS[service] || [];
  for (const key of CRED_FIELDS) {
    const el = document.getElementById(`cred-${key}`);
    if (el && el.value.trim()) body[key] = el.value.trim();
  }
  // Save before testing
  await fetch('/api/credentials', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (btn) { btn.disabled = true; btn.textContent = '⏳ Testing…'; }
  if (dot) dot.className = 'settings-status-dot testing';
  if (result) { result.textContent = ''; result.className = 'settings-test-result'; }

  try {
    const res = await fetch(`/api/credentials/test/${service}`, { method: 'POST' });
    const data = await res.json();
    if (data.ok) {
      const detail = data.result
        ? Object.entries(data.result).map(([k,v]) => `${k}: ${v}`).join(', ')
        : '';
      if (result) { result.textContent = `✅ Connected${detail ? ' — ' + detail : ''}`; result.className = 'settings-test-result ok'; }
      if (dot) dot.className = 'settings-status-dot connected';
      if (card) { card.classList.remove('is-error'); card.classList.add('is-connected'); }
    } else {
      if (result) { result.textContent = `❌ ${data.error}`; result.className = 'settings-test-result error'; }
      if (dot) dot.className = 'settings-status-dot error';
      if (card) { card.classList.remove('is-connected'); card.classList.add('is-error'); }
    }
  } catch (e) {
    if (result) { result.textContent = `❌ Network error: ${e.message}`; result.className = 'settings-test-result error'; }
    if (dot) dot.className = 'settings-status-dot error';
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '⚡ Test Connection'; }
  }
}

function toggleReveal(inputId, btn) {
  const el = document.getElementById(inputId);
  if (!el) return;
  if (el.type === 'password') {
    el.type = 'text';
    btn.style.opacity = '1';
  } else {
    el.type = 'password';
    btn.style.opacity = '0.5';
  }
}

function updateSettingsBadge() {
  // Count configured services
  const count = Object.entries(SERVICE_FIELDS)
    .filter(([, fields]) => fields.every(f => _savedCredKeys.has(f))).length;
  const badge = document.getElementById('settingsBadge');
  if (!badge) return;
  if (count > 0) {
    badge.textContent = `${count} live`;
    badge.style.display = 'inline-block';
  } else {
    badge.style.display = 'none';
  }
}

// ── Google Drive Backup / Restore ─────────────────────────────────
let driveAccessToken = null;
let driveConnected = false;

function loadDriveState() {
  const saved = localStorage.getItem('drive_backup_state');
  if (saved) {
    try {
      const state = JSON.parse(saved);
      driveAccessToken = state.accessToken || null;
      driveConnected = state.connected || false;
      const chkAuto = document.getElementById('chkAutoDriveBackup');
      if (chkAuto) chkAuto.checked = state.autoBackup || false;
      updateDriveUI();
    } catch {}
  }
  // Auto-backup timer
  setInterval(() => {
    if (driveConnected && document.getElementById('chkAutoDriveBackup')?.checked) {
      backupToDrive(true);
    }
  }, 30 * 60 * 1000); // every 30 min
}

function saveDriveState(autoBackup) {
  const state = {
    accessToken: driveAccessToken,
    connected: driveConnected,
    autoBackup: autoBackup !== undefined ? autoBackup : document.getElementById('chkAutoDriveBackup')?.checked || false
  };
  localStorage.setItem('drive_backup_state', JSON.stringify(state));
}

function updateDriveUI() {
  const statusEl = document.getElementById('driveStatus');
  const row = document.getElementById('driveStatusRow');
  const backupRow = document.getElementById('backupHistoryRow');
  const lastBackup = document.getElementById('lastBackupTime');
  const btnLogin = document.getElementById('btnDriveLogin');
  const btnBackup = document.getElementById('btnBackupNow');
  const btnRestore = document.getElementById('btnRestoreDrive');

  if (driveConnected) {
    if (statusEl) statusEl.textContent = '✅ Connected to Google Drive';
    if (row) row.style.display = 'flex';
    if (btnLogin) {
      btnLogin.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Connected';
      btnLogin.style.borderColor = '#34a853';
      btnLogin.style.color = '#34a853';
    }
    if (btnBackup) btnBackup.disabled = false;
    if (btnRestore) btnRestore.disabled = false;
  } else {
    if (statusEl) statusEl.textContent = 'Not connected';
    if (row) row.style.display = 'flex';
    if (btnLogin) {
      btnLogin.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="2"/><path d="M12 6v6l4 2"/></svg> Connect Drive';
      btnLogin.style.borderColor = 'rgba(52,168,83,0.3)';
      btnLogin.style.color = '#34a853';
    }
    if (btnBackup) btnBackup.disabled = true;
    if (btnRestore) btnRestore.disabled = true;
  }

  // Last backup time
  const savedTime = localStorage.getItem('drive_last_backup_time');
  if (savedTime && lastBackup) {
    lastBackup.textContent = new Date(savedTime).toLocaleString();
    if (backupRow) backupRow.style.display = 'flex';
  }
}

async function driveAuth() {
  // Use Google OAuth with Drive scope
  const clientId = localStorage.getItem('cred-youtubeClientId') || '';
  if (!clientId) {
    alert('Please enter your Google OAuth Client ID in YouTube API settings first (same client works for Drive).');
    return;
  }
  const redirectUri = window.location.origin + '/api/drive/callback';
  const scope = 'https://www.googleapis.com/auth/drive.file';
  const oauthUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=token&scope=${encodeURIComponent(scope)}&prompt=consent`;

  // Open popup
  const popup = window.open(oauthUrl, 'driveAuth', 'width=600,height=700');
  if (!popup) { alert('Please allow popups for Google Drive auth.'); return; }

  // Listen for the token in the URL via interval
  let driveResolved = false;
  const interval = setInterval(() => {
    try {
      if (popup.closed) { clearInterval(interval); return; }
      const href = popup.location.href;
      if (href && href.includes('access_token=')) {
        const params = new URLSearchParams(href.split('#')[1]);
        driveAccessToken = params.get('access_token');
        driveConnected = !!driveAccessToken;
        if (driveConnected) {
          saveDriveState();
          updateDriveUI();
          printToTerminal('[Drive Backup] ✅ Google Drive connected!', 'output-success');
          driveResolved = true;
        }
        popup.close();
        clearInterval(interval);
      }
    } catch {}
  }, 500);

  // Also listen for postMessage from callback page
  const msgHandler = (e) => {
    if (e.data && e.data.event === 'drive-connected' && e.data.accessToken && !driveResolved) {
      driveAccessToken = e.data.accessToken;
      driveConnected = true;
      saveDriveState();
      updateDriveUI();
      printToTerminal('[Drive Backup] ✅ Google Drive connected!', 'output-success');
      driveResolved = true;
      window.removeEventListener('message', msgHandler);
    }
  };
  window.addEventListener('message', msgHandler);
}

async function backupToDrive(silent) {
  if (!driveAccessToken) {
    if (!silent) alert('Please connect Google Drive first.');
    return;
  }
  const btn = document.getElementById('btnBackupNow');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Backing up...'; }
  const result = document.getElementById('result-backup');

  try {
    // Export all data from server
    const exportRes = await fetch('/api/backup/export');
    const data = await exportRes.json();
    if (data.error) throw new Error(data.error);

    // Upload to Google Drive
    const metadata = {
      name: `prime-autopilot-backup-${new Date().toISOString().slice(0,10)}.json`,
      mimeType: 'application/json'
    };
    const formData = new FormData();
    formData.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    formData.append('file', new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));

    const uploadRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${driveAccessToken}` },
      body: formData
    });
    const uploadResult = await uploadRes.json();
    if (uploadResult.error) throw new Error(uploadResult.error.message);

    // Save last backup time
    localStorage.setItem('drive_last_backup_time', new Date().toISOString());
    updateDriveUI();

    if (!silent) {
      if (result) { result.textContent = '✅ Backup uploaded to Google Drive!'; result.className = 'settings-test-result ok'; setTimeout(() => result.textContent = '', 4000); }
      printToTerminal(`[Drive Backup] ✅ Data backed up to Drive (file: ${metadata.name})`, 'output-success');
    }
  } catch (e) {
    if (!silent) {
      if (result) { result.textContent = `❌ ${e.message}`; result.className = 'settings-test-result error'; }
      printToTerminal(`[Drive Backup] ❌ ${e.message}`, 'output-error');
    }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Backup Now'; }
  }
}

async function restoreFromDrive() {
  if (!driveAccessToken) {
    alert('Please connect Google Drive first.');
    return;
  }
  if (!confirm('⚠️ Restoring will OVERWRITE all current data (workflows, queue, credentials, runs) with Drive backup. Continue?')) return;

  const btn = document.getElementById('btnRestoreDrive');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Restoring...'; }
  const result = document.getElementById('result-backup');

  try {
    // List backup files in Drive
    const listRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=name contains 'prime-autopilot-backup' and mimeType='application/json'&orderBy=createdTime desc&pageSize=5`, {
      headers: { 'Authorization': `Bearer ${driveAccessToken}` }
    });
    const list = await listRes.json();
    if (!list.files || list.files.length === 0) throw new Error('No backup files found in Drive');

    const fileId = list.files[0].id;
    // Download the file
    const dlRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
      headers: { 'Authorization': `Bearer ${driveAccessToken}` }
    });
    const backupData = await dlRes.json();
    if (!backupData.workflows && !backupData.credentials) throw new Error('Invalid backup file');

    // Import to server
    const importRes = await fetch('/api/backup/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: backupData })
    });
    const importResult = await importRes.json();
    if (!importResult.ok) throw new Error(importResult.error || 'Import failed');

    if (result) { result.textContent = `✅ Restored ${importResult.restored} items from Drive backup!`; result.className = 'settings-test-result ok'; setTimeout(() => result.textContent = '', 5000); }
    printToTerminal(`[Drive Backup] ✅ Restored ${importResult.restored} items from Drive! Refreshing page...`, 'output-success');
    setTimeout(() => location.reload(), 1500);
  } catch (e) {
    if (result) { result.textContent = `❌ ${e.message}`; result.className = 'settings-test-result error'; }
    printToTerminal(`[Drive Backup] ❌ Restore failed: ${e.message}`, 'output-error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Restore'; }
  }
}

// Init drive state on load
document.addEventListener('DOMContentLoaded', loadDriveState);

// Auto-backup toggle save
document.addEventListener('change', (e) => {
  if (e.target && e.target.id === 'chkAutoDriveBackup') {
    saveDriveState(e.target.checked);
    printToTerminal(`[Drive Backup] Auto-backup ${e.target.checked ? 'enabled' : 'disabled'}`, 'output-info');
  }
});

// Expose globally for HTML onclick handlers
window.saveAllCredentials = saveAllCredentials;
window.testConnection     = testConnection;
window.toggleReveal       = toggleReveal;
window.markSettingsDirty  = markSettingsDirty;
window.driveAuth          = driveAuth;
window.backupToDrive      = backupToDrive;
window.restoreFromDrive   = restoreFromDrive;

// Load credentials when Settings tab is opened
document.querySelectorAll('.nav-item[data-target="settings-view"]').forEach(btn => {
  btn.addEventListener('click', loadCredentials);
});

// ============================================================
// API KEY WARNING SYSTEM
// ============================================================
async function checkApiWarnings() {
  try {
    const res = await fetch('/api/credentials/status');
    if (!res.ok) return;
    const data = await res.json();
    const { summary } = data;
    const banner = document.getElementById('apiWarningBanner');
    const title = document.getElementById('apiWarningTitle');
    const detail = document.getElementById('apiWarningDetail');
    
    if (!banner || !summary) return;
    
    // Dismiss if user already dismissed this session
    if (sessionStorage.getItem('api_warning_dismissed') === 'true') return;
    
    if (summary.missingCritical && summary.missingCritical.length > 0) {
      const names = summary.missingCritical.map(k => data.statuses[k]?.label || k).join(', ');
      if (title) title.textContent = `⚠️ Missing: ${names}`;
      if (detail) detail.textContent = `${summary.configured}/${summary.total} APIs configured. Some features won't work without keys.`;
      banner.classList.remove('hidden');
    } else if (!summary.allConfigured) {
      if (title) title.textContent = `Some API keys are not configured`;
      if (detail) detail.textContent = `${summary.configured}/${summary.total} APIs connected. Add more in Settings.`;
      banner.classList.remove('hidden');
    }
  } catch {
    // API status check failed silently
  }
}

// Dismiss banner
document.addEventListener('click', (e) => {
  if (e.target.id === 'apiWarningCloseBtn' || e.target.closest('#apiWarningCloseBtn')) {
    const banner = document.getElementById('apiWarningBanner');
    if (banner) banner.classList.add('hidden');
    sessionStorage.setItem('api_warning_dismissed', 'true');
  }
});

// ============================================================
// FLOATING PRICING AD MODAL + SIGNUP BONUS + REFERRAL
// ============================================================

// Pricing page toggle (Admin panel Plans & Pricing section)
function switchPricingPeriod(period) {
  const tabs = document.querySelectorAll('.pricing-page-tab');
  tabs.forEach(t => {
    t.classList.toggle('active', t.dataset.period === period);
    t.style.background = t.dataset.period === period ? 'rgba(139,92,246,0.15)' : 'rgba(255,255,255,0.04)';
    t.style.color = t.dataset.period === period ? 'white' : 'rgba(255,255,255,0.5)';
  });
  const weeklyCards = document.querySelectorAll('.pricing-page-cards:not(.monthly-plans) .pricing-page-card');
  const monthlyCards = document.querySelectorAll('.pricing-page-cards.monthly-plans .pricing-page-card');
  if (period === 'weekly') {
    weeklyCards.forEach(c => c.closest('.pricing-page-cards').style.display = 'grid');
    monthlyCards.forEach(c => c.closest('.pricing-page-cards').style.display = 'none');
  } else {
    weeklyCards.forEach(c => c.closest('.pricing-page-cards').style.display = 'none');
    monthlyCards.forEach(c => c.closest('.pricing-page-cards').style.display = 'grid');
  }
}

// Load admin stats from server
async function loadAdminStats() {
  try {
    const data = await apiJson('/api/stats');
    if (data) {
      const el1 = document.getElementById('adminTotalUsers');
      const el2 = document.getElementById('adminTodayVisits');
      const el3 = document.getElementById('adminActiveSessions');
      const el4 = document.getElementById('adminTotalRevenue');
      if (el1) el1.textContent = data.workflowTotal || 0;
      if (el2) el2.textContent = data.runsCompleted || 0;
      if (el3) el3.textContent = data.queuePending || 0;
      if (el4) el4.textContent = '$' + ((data.mediaGenerated || 0) * 0.01).toFixed(2);
      // Render recent activity
      const logEl = document.getElementById('adminActivityLog');
      if (logEl && data.recentActivity && data.recentActivity.length) {
        logEl.innerHTML = data.recentActivity.map(r => {
          const color = r.status === 'completed' || r.status === 'success' ? '#22c55e' : '#ef4444';
          const icon = r.status === 'completed' || r.status === 'success' ? '✅' : '❌';
          const time = r.createdAt ? new Date(r.createdAt).toLocaleString() : '';
          return `<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:rgba(255,255,255,0.02);border-radius:8px;border:1px solid rgba(255,255,255,0.05)"><span>${icon}</span><span style="flex:1;font-size:0.82rem;color:rgba(255,255,255,0.7)">${r.workflowName || 'Task'}</span><span style="font-size:0.72rem;color:${color}">${r.status}</span><span style="font-size:0.7rem;color:rgba(255,255,255,0.3)">${time}</span></div>`;
        }).join('');
      }
    }
  } catch {}
}
function initPricingAd() {
  const overlay = document.getElementById('pricingAdOverlay');
  const closeBtn = document.getElementById('pricingAdClose');
  if (!overlay) return;

  // Check if bonus already claimed
  const bonusKey = 'pa_signup_bonus_claimed';
  const hasClaimedBonus = localStorage.getItem(bonusKey) === 'true';
  if (!hasClaimedBonus) {
    showSignupBonusNotice(overlay);
  }

  // Show ad after 1.5s
  setTimeout(() => {
    overlay.classList.remove('hidden');
  }, 1500);

  // Close button
  if (closeBtn) {
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closePricingAd(overlay);
    });
  }

  // Close on overlay click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closePricingAd(overlay);
  });

  // Close on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !overlay.classList.contains('hidden')) {
      closePricingAd(overlay);
    }
  });

  // Weekly/Monthly tabs
  const tabBtns = overlay.querySelectorAll('.pricing-ad-tab');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      const period = btn.dataset.period;
      overlay.querySelectorAll('.pricing-ad-card').forEach(card => {
        if (card.dataset.period === period) {
          card.classList.remove('hidden');
        } else {
          card.classList.add('hidden');
        }
      });
    });
  });

  // Referral system
  initReferralSystem();
}

function closePricingAd(overlay) {
  overlay.classList.add('closing');
  setTimeout(() => overlay.classList.add('hidden'), 300);
}

// ── Signup Bonus Notice (IP-based, one-time) ─────────────────
function showSignupBonusNotice(overlay) {
  const modal = overlay.querySelector('.pricing-ad-modal');
  if (!modal) return;

  // Inject bonus notice at top of modal
  const bonusHTML = `
    <div class="pa-bonus-notice" id="paBonusNotice">
      <div class="pa-bonus-glow"></div>
      <div class="pa-bonus-icon">🎉</div>
      <h3>Welcome Bonus!</h3>
      <p>Sign up & add a payment card to claim <strong>1 WEEK of Pro Plus ($6.1) FREE</strong></p>
      <div class="pa-bonus-timer">
        <span class="pa-bonus-timer-label">Offer expires in:</span>
        <div class="pa-bonus-countdown" id="paBonusCountdown">23:59:59</div>
      </div>
      <button class="pabtn pabtn-pro pa-bonus-claim-btn" id="paBonusClaimBtn">Claim Free Pro Plus →</button>
      <p class="pa-bonus-small">One-time offer per device. No credit charged until trial ends.</p>
    </div>
  `;
  modal.insertAdjacentHTML('afterbegin', bonusHTML);

  // Countdown timer (24h)
  const countdownEl = document.getElementById('paBonusCountdown');
  if (countdownEl) {
    let remaining = 24 * 60 * 60; // 24 hours in seconds
    const timer = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearInterval(timer);
        countdownEl.textContent = '00:00:00';
        return;
      }
      const h = Math.floor(remaining / 3600);
      const m = Math.floor((remaining % 3600) / 60);
      const s = remaining % 60;
      countdownEl.textContent = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    }, 1000);
  }

  // Claim button
  const claimBtn = document.getElementById('paBonusClaimBtn');
  if (claimBtn) {
    claimBtn.addEventListener('click', () => {
      localStorage.setItem('pa_signup_bonus_claimed', 'true');
      const notice = document.getElementById('paBonusNotice');
      if (notice) notice.remove();
      printToTerminal('[Pricing] 🎉 Welcome bonus claimed! Pro Plus activated for 1 week.', 'output-success');
    });
  }
}

// ── Referral System ──────────────────────────────────────────
function initReferralSystem() {
  // Generate unique referral code
  let refCode = localStorage.getItem('pa_ref_code');
  if (!refCode) {
    refCode = 'REF-' + Math.random().toString(36).substring(2, 8).toUpperCase();
    localStorage.setItem('pa_ref_code', refCode);
  }

  let refCount = parseInt(localStorage.getItem('pa_ref_count') || '0', 10);
  let refEarnings = parseFloat(localStorage.getItem('pa_ref_earnings') || '0');

  // Simulate referral earnings on each visit (for demo)
  if (refCount > 0 && refCount < 100) {
    const perRef = 0.005;
    refEarnings = refCount * perRef;
    localStorage.setItem('pa_ref_earnings', refEarnings.toString());
  }

  const overlay = document.getElementById('pricingAdOverlay');
  if (!overlay) return;
  const modal = overlay.querySelector('.pricing-ad-modal');
  if (!modal) return;

  const refSection = document.createElement('div');
  refSection.className = 'pa-referral-section';
  refSection.innerHTML = `
    <div class="pa-ref-header">
      <span class="pa-ref-icon">🔗</span>
      <div>
        <strong>Refer & Earn Free Access</strong>
        <span class="pa-ref-sub">$0.005 per referral • 100 referrals = Weekly Lite FREE forever</span>
      </div>
    </div>
    <div class="pa-ref-code-row">
      <input type="text" class="pa-ref-code-input" value="${refCode}" readonly id="paRefCodeInput">
      <button class="pa-ref-copy-btn" id="paRefCopyBtn">📋 Copy</button>
    </div>
    <div class="pa-ref-stats">
      <div class="pa-ref-stat">
        <span class="pa-ref-stat-num" id="paRefCount">${refCount}</span>
        <span class="pa-ref-stat-label">Referrals</span>
      </div>
      <div class="pa-ref-stat">
        <span class="pa-ref-stat-num" id="paRefEarnings">$${refEarnings.toFixed(3)}</span>
        <span class="pa-ref-stat-label">Earned</span>
      </div>
      <div class="pa-ref-stat">
        <span class="pa-ref-stat-num" id="paRefProgress">${Math.min(refCount, 100)}/100</span>
        <span class="pa-ref-stat-label">To Free Lite</span>
      </div>
    </div>
    <div class="pa-ref-progress-bar">
      <div class="pa-ref-progress-fill" style="width:${Math.min(refCount, 100)}%"></div>
    </div>
    ${refCount >= 100 ? '<div class="pa-ref-unlocked">🎉 You earned Weekly Lite — FREE forever!</div>' : ''}
    <p class="pa-ref-note">Share your code. Each signup = $0.005 credit. At 100 referrals, Weekly Lite is yours — every week, forever.</p>
  `;
  modal.appendChild(refSection);

  // Copy button
  const copyBtn = document.getElementById('paRefCopyBtn');
  const codeInput = document.getElementById('paRefCodeInput');
  if (copyBtn && codeInput) {
    copyBtn.addEventListener('click', () => {
      codeInput.select();
      navigator.clipboard.writeText(codeInput.value).then(() => {
        copyBtn.textContent = '✅ Copied!';
        setTimeout(() => { copyBtn.textContent = '📋 Copy'; }, 2000);
      }).catch(() => {
        document.execCommand('copy');
        copyBtn.textContent = '✅ Copied!';
        setTimeout(() => { copyBtn.textContent = '📋 Copy'; }, 2000);
      });
    });
  }

  // Simulate a referral (for demo — increments on page reload)
  const simulated = localStorage.getItem('pa_ref_simulated_session');
  if (!simulated && refCount > 0 && refCount < 100) {
    refCount++;
    localStorage.setItem('pa_ref_count', refCount.toString());
    localStorage.setItem('pa_ref_simulated_session', 'true');
    const countEl = document.getElementById('paRefCount');
    const earningsEl = document.getElementById('paRefEarnings');
    const progressEl = document.getElementById('paRefProgress');
    if (countEl) countEl.textContent = refCount;
    if (earningsEl) earningsEl.textContent = '$' + (refCount * 0.005).toFixed(3);
    if (progressEl) progressEl.textContent = Math.min(refCount, 100) + '/100';
    const fill = refSection.querySelector('.pa-ref-progress-fill');
    if (fill) fill.style.width = Math.min(refCount, 100) + '%';
  }
}

// ============================================================
// AUTO-POST FROM LOCAL UPLOAD (in Autopilot tab)
// ============================================================
function initAutoPostUpload() {
  const autopilotRight = document.querySelector('.autopilot-right');
  if (!autopilotRight) return;

  // Find the Manual Upload panel and inject the auto-post section after it
  const manualUploadPanels = autopilotRight.querySelectorAll('.autopilot-panel');
  let manualPanel = null;
  manualUploadPanels.forEach(p => {
    const title = p.querySelector('.panel-title');
    if (title && title.textContent.includes('Manual Upload')) manualPanel = p;
  });

  if (!manualPanel) return;

  const section = document.createElement('div');
  section.className = 'auto-post-upload-section';
  section.innerHTML = `
    <h4>⚡ Quick Auto-Post</h4>
    <p style="font-size:0.72rem;color:var(--secondary);margin:0 0 12px">Upload a file → auto-queue → publish to connected platform</p>
    <div class="auto-post-dropzone" id="autoPostDropzone">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
        <polyline points="17 8 12 3 7 8"></polyline>
        <line x1="12" y1="3" x1="12" y2="15"></line>
      </svg>
      <p>Drop image or video here, or click to browse</p>
      <p class="dropzone-hint">JPG, PNG, MP4, MOV — Max 300MB</p>
      <input type="file" id="autoPostFileInput" accept="image/*,video/*" hidden>
    </div>
    <div class="auto-post-preview" id="autoPostPreview">
      <img id="autoPostPreviewImg" src="" alt="Preview">
      <button class="preview-remove" id="autoPostPreviewRemove">✕</button>
    </div>
    <div class="auto-post-actions">
      <select id="autoPostPlatform" style="background:var(--bg-secondary);color:var(--text-main);border:1px solid var(--border-color);border-radius:6px;padding:8px 12px;font-size:0.78rem;">
        <option value="fb">Facebook</option>
        <option value="yt">YouTube</option>
      </select>
      <button class="btn-auto-post" id="btnAutoPost">🚀 Upload & Auto-Post</button>
    </div>
    <div class="auto-post-status" id="autoPostStatus"></div>
  `;
  manualPanel.appendChild(section);

  const dropzone = document.getElementById('autoPostDropzone');
  const fileInput = document.getElementById('autoPostFileInput');
  const preview = document.getElementById('autoPostPreview');
  const previewImg = document.getElementById('autoPostPreviewImg');
  const removeBtn = document.getElementById('autoPostPreviewRemove');
  const postBtn = document.getElementById('btnAutoPost');
  const statusEl = document.getElementById('autoPostStatus');
  const platformSelect = document.getElementById('autoPostPlatform');
  let autoPostFile = null;

  if (!dropzone || !fileInput) return;

  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    if (e.dataTransfer.files[0]) handleAutoPostFile(e.dataTransfer.files[0]);
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files[0]) handleAutoPostFile(e.target.files[0]);
  });

  function handleAutoPostFile(file) {
    if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
      if (statusEl) { statusEl.textContent = '❌ Only images and videos are supported'; statusEl.className = 'auto-post-status error'; }
      return;
    }
    autoPostFile = file;
    dropzone.classList.add('hidden');
    preview.classList.add('active');
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (e) => { previewImg.src = e.target.result; };
      reader.readAsDataURL(file);
    } else {
      previewImg.src = '';
      previewImg.alt = '🎬 Video: ' + file.name;
    }
    if (statusEl) { statusEl.textContent = ''; statusEl.className = 'auto-post-status'; }
  }

  if (removeBtn) {
    removeBtn.addEventListener('click', () => {
      autoPostFile = null;
      fileInput.value = '';
      dropzone.classList.remove('hidden');
      preview.classList.remove('active');
    });
  }

  if (postBtn) {
    postBtn.addEventListener('click', async () => {
      if (!autoPostFile) {
        if (statusEl) { statusEl.textContent = '❌ Please select a file first'; statusEl.className = 'auto-post-status error'; }
        return;
      }
      if (!requireSignedIn('auto-post upload')) return;

      const platform = platformSelect ? platformSelect.value : 'fb';
      const connKey = platform;
      if (!connectedPlatforms[connKey]) {
        if (statusEl) { statusEl.textContent = `❌ Connect ${platform === 'fb' ? 'Facebook' : 'YouTube'} first`; statusEl.className = 'auto-post-status error'; }
        return;
      }

      postBtn.disabled = true;
      postBtn.textContent = '⏳ Uploading...';
      if (statusEl) { statusEl.textContent = 'Uploading file to server...'; statusEl.className = 'auto-post-status'; }

      try {
        // Convert file to data URL
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error('Failed to read file'));
          reader.readAsDataURL(autoPostFile);
        });

        const res = await fetch('/api/upload-auto-post', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            dataUrl: dataUrl,
            fileName: autoPostFile.name,
            mimeType: autoPostFile.type,
            caption: autoPostFile.name.replace(/\.[^.]+$/, ''),
            platform: platform
          })
        });

        const data = await res.json();
        if (!data.ok) throw new Error(data.error || 'Upload failed');

        // Add to social queue
        const item = data.queueItem || {
          id: Date.now(),
          title: autoPostFile.name.replace(/\.[^.]+$/, '').slice(0, 80),
          caption: autoPostFile.name.replace(/\.[^.]+$/, ''),
          type: platform,
          time: new Date().toLocaleString(),
          media: '',
          mediaType: autoPostFile.type.startsWith('video/') ? 'video' : 'image',
          uploadRef: data.upload,
          source: 'auto-post-upload'
        };

        socialQueue.unshift(item);
        localStorage.setItem('autopilot_queue', JSON.stringify(socialQueue));
        renderQueue();

        // Auto hashtag
        autoHashtagAndSeo(item).then(enhanced => {
          Object.assign(item, enhanced);
          localStorage.setItem('autopilot_queue', JSON.stringify(socialQueue));
          renderQueue();
        });

        // Auto publish if enabled
        if (chkAutoPublish && chkAutoPublish.checked) {
          if (statusEl) { statusEl.textContent = '✅ Uploaded! Auto-publishing...'; statusEl.className = 'auto-post-status success'; }
          triggerAutoPublishSimulation(item);
        } else {
          if (statusEl) { statusEl.textContent = '✅ Uploaded and queued! Enable Auto-Publish to post immediately.'; statusEl.className = 'auto-post-status success'; }
        }

        printToTerminal(`[Auto-Post] ✅ "${item.title}" uploaded and queued for ${platform === 'fb' ? 'Facebook' : 'YouTube'}`, 'output-success');
        printToOverviewLogs(`Auto-post upload: '${item.title}'`, 'success');

        // Reset UI
        autoPostFile = null;
        fileInput.value = '';
        dropzone.classList.remove('hidden');
        preview.classList.remove('active');
      } catch (err) {
        if (statusEl) { statusEl.textContent = '❌ ' + err.message; statusEl.className = 'auto-post-status error'; }
        printToTerminal(`[Auto-Post] Error: ${err.message}`, 'output-error');
      } finally {
        postBtn.disabled = false;
        postBtn.textContent = '🚀 Upload & Auto-Post';
      }
    });
  }
}

// Start App
initializeApp().then(() => {
  // Dashboard always visible
  const appContainer = document.querySelector('.app-container');
  const titlebar = document.querySelector('.titlebar');
  if (appContainer) appContainer.style.display = 'flex';
  if (titlebar) titlebar.style.display = 'flex';
  // Check API key warnings
  checkApiWarnings();
  // Initialize auto-post upload in Autopilot tab
  setTimeout(() => initAutoPostUpload(), 500);
}).catch((err) => {
  console.error('App initialization failed:', err);
  // Still show dashboard even on error
  const appContainer = document.querySelector('.app-container');
  const titlebar = document.querySelector('.titlebar');
  if (appContainer) appContainer.style.display = 'flex';
  if (titlebar) titlebar.style.display = 'flex';
}).finally(() => {
  // Always initialize pricing ad — run regardless of init success/failure
  initPricingAd();
});

