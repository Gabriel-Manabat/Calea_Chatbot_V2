/* ── Config ── */
// IMPORTANT: Paste your NEW Gemini API Key here
const GEMINI_API_KEY = "YOUR API KEY HERE";

/* ── State & Persistence ── */
const STORAGE_KEY = 'finance_assistant_data';

function loadState() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
    return {
        budget: 0,
        spent: 0,
        expenses: [],
        conversationHistory: [],
        goals: []
    };
}

const state = loadState();

function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

/* ── System Prompt ── */
const SYSTEM_PROMPT = `You are a friendly and practical Finance & Budgeting Assistant. You help users:
1. Track and categorize expenses (food, transport, utilities, entertainment, health, shopping, others)
2. Track income and additions to the budget
3. Give specific, actionable saving suggestions based on their spending patterns
4. Answer financial questions in simple, clear language
5. Manage savings goals (add, update, or delete goals)

Key behaviors:
- When a user mentions spending money, extract: amount, category, and description. Respond warmly.
- When a user mentions receiving, gaining, or earning money, extract the amount and description. You MUST acknowledge that their total budget has increased.
- When setting a budget, acknowledge it warmly and calculate how much is left.
- When adding/updating/deleting saving goals, use the exact goal name.
- Keep responses concise (2-4 sentences max).
- Use ₱ (Philippine Peso) as default currency.
- ABSOLUTE RULE: ALWAYS trust the "Current user financial state" JSON at the bottom of this prompt over your conversation history. If a goal is not listed in the JSON, it DOES NOT EXIST.

IMPORTANT: If you perform an action, include the corresponding JSON/command at the VERY END of your response on a new line. Do NOT wrap it in markdown blockticks like \`\`\`json. Just output the raw text:

For logging an expense (decreases remaining):
EXPENSE_LOG:{"amount":NUMBER,"category":"CATEGORY","description":"SHORT REASON"}

For logging income or gained money (increases budget):
INCOME_LOG:{"amount":NUMBER,"description":"SHORT REASON"}

For setting a budget:
BUDGET_SET:NUMBER

For adding a new goal:
GOAL_ADD:{"name":"Goal Name","target":NUMBER,"saved":NUMBER}

For updating progress on an existing goal:
GOAL_UPDATE:{"name":"Goal Name","added_amount":NUMBER}

For deleting a goal:
GOAL_DELETE:"Goal Name"`;

/* ── DOM Helpers ── */
function $(id) { return document.getElementById(id); }

function updateStats() {
    const remaining = state.budget - state.spent;
    $('stat-budget').textContent = '₱' + state.budget.toLocaleString();
    $('stat-spent').textContent = '₱' + state.spent.toLocaleString();
    const remEl = $('stat-remaining');
    remEl.textContent = '₱' + Math.abs(remaining).toLocaleString() + (remaining < 0 ? ' over' : '');
    remEl.className = 'stat-value ' + (remaining < 0 ? 'red' : 'green');
}

/* ── Tabs ── */
function switchTab(name) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));

    const targetBtn = document.querySelector(`.tab-btn[data-tab="${name}"]`);
    if (targetBtn) targetBtn.classList.add('active');

    const targetPanel = document.getElementById(name + '-panel');
    if (targetPanel) targetPanel.classList.add('active');

    if (name === 'analytics') renderAnalytics();
    if (name === 'history') renderHistory();
    if (name === 'goals') renderGoals();
}

// NEW: Forces tabs to update immediately behind the scenes
function refreshActiveTabs() {
    if ($('history-panel') && $('history-panel').classList.contains('active')) renderHistory();
    if ($('analytics-panel') && $('analytics-panel').classList.contains('active')) renderAnalytics();
    if ($('goals-panel') && $('goals-panel').classList.contains('active')) renderGoals();
}

/* ── Chat ── */
function addMessage(text, role) {
    const msgs = $('messages');
    const chatPanel = $('chat-panel');

    const div = document.createElement('div');
    div.className = 'msg ' + (role === 'user' ? 'user' : 'bot');

    const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    div.innerHTML = `<div class="bubble">${text}</div><div class="msg-time">${now}</div>`;

    msgs.appendChild(div);

    if (chatPanel.classList.contains('active')) {
        msgs.scrollTop = msgs.scrollHeight;
    }
}

function showTyping() {
    const msgs = $('messages');
    const chatPanel = $('chat-panel');

    const div = document.createElement('div');
    div.className = 'msg bot';
    div.id = 'typing-indicator';
    div.innerHTML = '<div class="typing"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>';

    msgs.appendChild(div);

    if (chatPanel.classList.contains('active')) {
        msgs.scrollTop = msgs.scrollHeight;
    }
}

function parseResponse(text) {
    let clean = text;

    // Extract expense logs
    const expMatch = clean.match(/EXPENSE_LOG:\s*(\{[^}]+\})/);
    if (expMatch) {
        try {
            const exp = JSON.parse(expMatch[1]);
            const amt = parseFloat(exp.amount) || 0; // Prevent string glue bug
            state.spent += amt;
            state.expenses.push({ ...exp, amount: amt, date: new Date().toISOString() });
            updateStats();
            saveState();
            refreshActiveTabs();
        } catch (e) { console.error(e); }
        clean = clean.replace(expMatch[0], '').trim();
    }

    // Extract income logs
    const incMatch = clean.match(/INCOME_LOG:\s*(\{[^}]+\})/);
    if (incMatch) {
        try {
            const inc = JSON.parse(incMatch[1]);
            const amt = parseFloat(inc.amount) || 0; // Prevent string glue bug
            state.budget += amt;
            state.expenses.push({ amount: amt, category: 'income', description: inc.description, type: 'income', date: new Date().toISOString() });
            updateStats();
            saveState();
            refreshActiveTabs();
        } catch (e) { console.error(e); }
        clean = clean.replace(incMatch[0], '').trim();
    }

    // Extract budget updates
    const budMatch = clean.match(/BUDGET_SET:\s*(\d+)/);
    if (budMatch) {
        state.budget = parseInt(budMatch[1]);
        updateStats();
        saveState();
        clean = clean.replace(budMatch[0], '').trim();
    }

    // Extract goal additions
    const goalAddMatch = clean.match(/GOAL_ADD:\s*(\{[^}]+\})/);
    if (goalAddMatch) {
        try {
            const newGoal = JSON.parse(goalAddMatch[1]);
            state.goals.push({
                name: newGoal.name,
                target: parseFloat(newGoal.target) || 0,
                saved: parseFloat(newGoal.saved) || 0
            });
            saveState();
            refreshActiveTabs();
        } catch (e) { console.error(e); }
        clean = clean.replace(goalAddMatch[0], '').trim();
    }

    // Extract goal updates
    const goalUpdateMatch = clean.match(/GOAL_UPDATE:\s*(\{[^}]+\})/);
    if (goalUpdateMatch) {
        try {
            const update = JSON.parse(goalUpdateMatch[1]);
            const targetName = update.name.toLowerCase().trim();
            const goalIndex = state.goals.findIndex(g => g.name.toLowerCase().trim() === targetName);

            if (goalIndex !== -1) {
                state.goals[goalIndex].saved += parseFloat(update.added_amount) || 0;
                saveState();
                refreshActiveTabs();
            }
        } catch (e) { console.error(e); }
        clean = clean.replace(goalUpdateMatch[0], '').trim();
    }

    // Extract goal deletions
    const goalDelMatch = clean.match(/GOAL_DELETE:\s*"([^"]+)"/);
    if (goalDelMatch) {
        const targetName = goalDelMatch[1].toLowerCase().trim();
        state.goals = state.goals.filter(g => g.name.toLowerCase().trim() !== targetName);
        saveState();
        refreshActiveTabs();
        clean = clean.replace(goalDelMatch[0], '').trim();
    }

    // FAILSAFE: Strip remaining tags
    clean = clean.replace(/EXPENSE_LOG:.*$/gm, '')
        .replace(/INCOME_LOG:.*$/gm, '')
        .replace(/BUDGET_SET:.*$/gm, '')
        .replace(/GOAL_ADD:.*$/gm, '')
        .replace(/GOAL_UPDATE:.*$/gm, '')
        .replace(/GOAL_DELETE:.*$/gm, '')
        .trim();

    return clean;
}

async function sendMsg() {
    const input = $('user-input');
    const text = input.value.trim();
    if (!text) return;

    input.value = '';
    addMessage(text, 'user');

    state.conversationHistory.push({ role: 'user', parts: [{ text: text }] });
    showTyping();

    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${GEMINI_API_KEY}`;

        const payloadHistory = JSON.parse(JSON.stringify(state.conversationHistory));

        // INJECTION: Force the AI to read the live state
        const liveState = JSON.stringify({ budget: state.budget, spent: state.spent, expenses: state.expenses, goals: state.goals });
        payloadHistory[payloadHistory.length - 1].parts[0].text += `\n\n[SYSTEM NOTE TO AI: The live database state is currently: ${liveState}. If a goal is not listed here, it DOES NOT EXIST regardless of past chat history. Base your response strictly on this live data.]`;

        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
                contents: payloadHistory,
                generationConfig: { temperature: 0.7 }
            })
        });

        const data = await res.json();
        if (data.error) throw new Error(data.error.message);

        const rawReply = data.candidates[0].content.parts[0].text;
        const cleanReply = parseResponse(rawReply);

        $('typing-indicator')?.remove();

        state.conversationHistory.push({ role: 'model', parts: [{ text: cleanReply }] });
        saveState();

        addMessage(cleanReply, 'bot');

    } catch (e) {
        console.error("API Error:", e);
        $('typing-indicator')?.remove();
        addMessage('Sorry, I am having trouble connecting right now. Please check your API key and connection.', 'bot');
        state.conversationHistory.pop();
    }
}

function sendChip(el) {
    $('user-input').value = el.textContent;
    sendMsg();
}

/* ── Analytics & History ── */
const CAT_ICONS = {
    food: '🍔', transport: '🚗', utilities: '💡',
    entertainment: '🎬', health: '💊', shopping: '🛍️', others: '📦', income: '💵'
};

function renderAnalytics() {
    const panel = $('analytics-panel');
    panel.innerHTML = '';

    // Filter out income logs so they don't show up in the expense pie chart
    const validExpenses = state.expenses.filter(e => e.type !== 'income');

    if (validExpenses.length === 0) {
        panel.innerHTML = '<div class="empty-state"><span>📊</span>No expenses logged yet.<br>Start tracking in Chat!</div>';
        return;
    }

    const cats = {};
    validExpenses.forEach(e => {
        const c = (e.category || 'others').toLowerCase();
        cats[c] = (cats[c] || 0) + e.amount;
    });
    const maxAmt = Math.max(...Object.values(cats));

    const title = document.createElement('div');
    title.className = 'section-title';
    title.textContent = 'Spending by category';
    panel.appendChild(title);

    Object.entries(cats)
        .sort((a, b) => b[1] - a[1])
        .forEach(([cat, amt]) => {
            const row = document.createElement('div');
            row.className = 'category-row';
            row.innerHTML = `
        <div class="category-label">${CAT_ICONS[cat] || '📦'} ${cat.charAt(0).toUpperCase() + cat.slice(1)}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${(amt / maxAmt * 100).toFixed(1)}%"></div></div>
        <div class="category-amt">₱${amt.toLocaleString()}</div>
      `;
            panel.appendChild(row);
        });

    const totalRow = document.createElement('div');
    totalRow.style.cssText = 'margin-top:8px;padding-top:10px;border-top:1px solid var(--border);display:flex;justify-content:space-between;font-size:13px;color:var(--text-secondary)';
    totalRow.innerHTML = `<span>Total spent</span><span style="font-family:var(--mono);color:var(--red)">₱${state.spent.toLocaleString()}</span>`;
    panel.appendChild(totalRow);
}

function renderHistory() {
    const panel = $('history-panel');
    panel.innerHTML = '';

    if (state.expenses.length === 0) {
        panel.innerHTML = '<div class="empty-state"><span>🧾</span>No transactions yet.</div>';
        return;
    }

    const title = document.createElement('div');
    title.className = 'section-title';
    title.textContent = 'Recent transactions';
    panel.appendChild(title);

    [...state.expenses].reverse().forEach(e => {
        const isIncome = e.type === 'income';
        const cat = isIncome ? 'income' : (e.category || 'others').toLowerCase();
        const dateStr = e.date ? new Date(e.date).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }) : 'Today';

        const amtStr = isIncome ? `+₱${e.amount.toLocaleString()}` : `−₱${e.amount.toLocaleString()}`;
        const amtColor = isIncome ? '#4CAF50' : 'var(--text-primary)';

        const item = document.createElement('div');
        item.className = 'history-item';
        item.innerHTML = `
      <div class="history-left">
        <div class="history-icon">${CAT_ICONS[cat] || '📦'}</div>
        <div>
          <div class="history-desc">${e.description || (isIncome ? 'Income' : 'Expense')}</div>
          <div class="history-cat">${cat.charAt(0).toUpperCase() + cat.slice(1)} · ${dateStr}</div>
        </div>
      </div>
      <div class="history-amt" style="color: ${amtColor}">${amtStr}</div>
    `;
        panel.appendChild(item);
    });
}

/* ── Goals ── */
function renderGoals() {
    const panel = $('goals-panel');
    panel.innerHTML = '';

    const title = document.createElement('div');
    title.className = 'section-title';
    title.textContent = 'Savings goals';
    panel.appendChild(title);

    if (state.goals.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.innerHTML = '<span>🎯</span>Looks like you don\'t have any goals yet.';
        panel.appendChild(empty);
    } else {
        state.goals.forEach((g, index) => {
            const pct = Math.min(100, Math.round((g.saved / g.target) * 100));
            const card = document.createElement('div');
            card.className = 'goal-card';
            card.innerHTML = `
        <div class="goal-header">
          <div class="goal-name">${g.name}</div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <div class="goal-pct">${pct}%</div>
            <button class="delete-goal-btn" style="background: transparent; border: none; color: var(--text-tertiary); font-size: 18px; cursor: pointer; line-height: 1;" title="Delete goal">&times;</button>
          </div>
        </div>
        <div class="goal-bar-track">
          <div class="goal-bar-fill" style="width:${pct}%"></div>
        </div>
        <div class="goal-meta">
          <span>₱${g.saved.toLocaleString()} saved</span>
          <span>₱${g.target.toLocaleString()} goal</span>
        </div>
      `;

            card.querySelector('.delete-goal-btn').onclick = () => {
                if (confirm(`Are you sure you want to delete the goal: "${g.name}"?`)) {
                    state.goals.splice(index, 1);
                    saveState();
                    renderGoals();
                }
            };

            panel.appendChild(card);
        });
    }

    const addBtn = document.createElement('button');
    addBtn.className = 'add-goal-btn';
    addBtn.innerHTML = '＋ Add new goal';
    addBtn.onclick = () => {
        const name = prompt('Goal name:');
        const target = parseFloat(prompt('Target amount (₱):'));
        if (name && !isNaN(target)) {
            state.goals.push({ name, target, saved: 0 });
            saveState();
            renderGoals();
        }
    };
    panel.appendChild(addBtn);
}

/* ── Initialization ── */
function init() {
    updateStats();

    if (state.conversationHistory.length > 0) {
        state.conversationHistory.forEach(msg => {
            addMessage(msg.parts[0].text, msg.role === 'model' ? 'bot' : 'user');
        });
    }
}

init();
