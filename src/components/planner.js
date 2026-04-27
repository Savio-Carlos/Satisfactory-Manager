import { getState, setState, showToast, fmt, fmtRate, itemIcon } from '../modules/state.js';
import { api } from '../modules/api.js';
import { renderFlowchart, initFlowchart } from './flowchart.js';

let plannerState = { targetItem: '', targetRate: 10, recipeOverrides: {}, result: null, activeTab: 'overview' };

export function renderPlanner() {
    const { gameData } = getState();
    if (!gameData) return '<div class="loading-overlay"><div class="loading-spinner"></div>Loading game data...</div>';

    const producibleItems = Object.entries(gameData.itemRecipeMap)
        .map(([itemId]) => ({ id: itemId, name: gameData.items[itemId]?.name || itemId }))
        .sort((a, b) => a.name.localeCompare(b.name));

    const itemOptions = producibleItems
        .map(i => `<option value="${i.id}" ${i.id === plannerState.targetItem ? 'selected' : ''}>${i.name}</option>`)
        .join('');

    const hasResult = !!plannerState.result;
    const tab = plannerState.activeTab;

    let resultContent = '';
    if (!hasResult) {
        resultContent = `<div class="empty-state">
            <div class="empty-state-icon">🔧</div>
            <h3>Select an item to produce</h3>
            <p>Choose a target item and desired rate, then click Calculate to see the full production chain.</p>
        </div>`;
    } else {
        resultContent = `
        <div class="planner-tabs">
            <button class="planner-tab ${tab === 'overview' ? 'active' : ''}" data-tab="overview">📋 Overview</button>
            <button class="planner-tab ${tab === 'visualization' ? 'active' : ''}" data-tab="visualization">🔗 Visualization</button>
            <button class="planner-tab ${tab === 'items' ? 'active' : ''}" data-tab="items">📦 Items</button>
        </div>
        <div id="planner-tab-content">
            ${tab === 'overview' ? renderOverviewTab(plannerState.result, gameData) : ''}
            ${tab === 'visualization' ? renderVisualizationTab() : ''}
            ${tab === 'items' ? renderItemsTab(plannerState.result, gameData) : ''}
        </div>`;
    }

    return `
    <div class="fade-in">
        <div class="page-header">
            <div>
                <h1>Production Planner</h1>
                <p>Design new factories and calculate resource requirements</p>
            </div>
        </div>
        <div class="planner-layout">
            <div class="planner-results" id="planner-results">${resultContent}</div>
            <div class="planner-config">
                <div class="card">
                    <div class="card-title" style="margin-bottom:16px">Configuration</div>
                    <div class="input-group">
                        <label>Target Item</label>
                        <select id="planner-item"><option value="">Select item...</option>${itemOptions}</select>
                    </div>
                    <div class="input-group">
                        <label>Target Rate</label>
                        <input type="number" id="planner-rate" value="${plannerState.targetRate}" min="0.1" step="0.1" />
                    </div>
                    <button class="btn btn-primary" id="planner-calc" style="width:100%">Calculate Production Chain</button>
                </div>
                ${plannerState.targetItem && gameData.itemRecipeMap[plannerState.targetItem] ? `
                <div class="card" style="margin-top:16px">
                    <div class="card-title" style="margin-bottom:12px">Recipe Selection</div>
                    <div class="card-subtitle" style="margin-bottom:12px">Choose preferred recipes for each step</div>
                    <div id="recipe-overrides">${renderRecipeOverrides(gameData)}</div>
                </div>` : ''}
            </div>
        </div>
    </div>`;
}

function renderRecipeOverrides(gameData) {
    if (!plannerState.targetItem) return '';
    const { unlockedAlternates } = getState();

    // Find all items in the chain following SELECTED recipes (not just defaults)
    const itemsWithAlts = new Set();
    function findItems(itemId, visited = new Set()) {
        if (visited.has(itemId)) return;
        visited.add(itemId);
        const recipes = gameData.itemRecipeMap[itemId];
        if (!recipes || recipes.length === 0) return;
        if (recipes.length > 1) itemsWithAlts.add(itemId);

        // Follow the SELECTED recipe, not just the default
        let selectedRecipeId = plannerState.recipeOverrides[itemId];
        if (!selectedRecipeId) {
            selectedRecipeId = recipes.find(rId => !gameData.recipes[rId]?.isAlternate) || recipes[0];
        }
        const recipe = gameData.recipes[selectedRecipeId];
        if (recipe && recipe.manufacturingDuration > 0) {
            for (const ing of recipe.ingredients) {
                findItems(ing.itemId, visited);
            }
        }
    }
    findItems(plannerState.targetItem);

    if (itemsWithAlts.size === 0) return '<p style="color:var(--text-muted);font-size:12px">No alternate recipes available in this chain.</p>';

    let html = '';
    for (const itemId of itemsWithAlts) {
        const recipes = gameData.itemRecipeMap[itemId];
        const itemName = gameData.items[itemId]?.name || itemId;
        const currentOverride = plannerState.recipeOverrides[itemId] || '';
        const options = recipes.map(rId => {
            const r = gameData.recipes[rId];
            const unlocked = !r.isAlternate || (unlockedAlternates || []).includes(rId);
            const label = r.name + (r.isAlternate ? (unlocked ? ' ★' : ' 🔒') : '');
            return `<option value="${rId}" ${rId === currentOverride ? 'selected' : ''}>${label}</option>`;
        }).join('');
        html += `<div class="input-group" style="margin-bottom:10px">
            <label>${itemName}</label>
            <select class="recipe-override-select" data-item-id="${itemId}">
                <option value="">Default</option>${options}
            </select>
        </div>`;
    }
    return html;
}

function renderOverviewTab(result, gameData) {
    const targetName = gameData.items[result.targetItemId]?.name || result.targetItemId;

    let stepsHTML = '';
    for (const step of result.steps) {
        const building = step.buildingId ? gameData.buildings[step.buildingId] : null;
        stepsHTML += `<div class="production-step">
            <div class="step-header">
                <span class="step-machine">${building?.name || 'Unknown'} — ${step.recipeName}</span>
                <span class="step-count">×${step.machineCount} @ ${fmt(step.clockSpeed)}%</span>
            </div>
            <div class="step-flows">
                <div class="step-flow">
                    <div class="step-flow-title">Inputs</div>
                    ${step.inputs.map(inp => `<div class="step-flow-item">
                        <span>${gameData.items[inp.itemId]?.name || inp.itemId}</span>
                        <span class="rate">${fmtRate(inp.ratePerMachine * step.machineCountRaw, inp.itemId, gameData)}</span>
                    </div>`).join('')}
                </div>
                <div class="step-flow">
                    <div class="step-flow-title">Outputs</div>
                    ${step.outputs.map(out => `<div class="step-flow-item">
                        <span>${gameData.items[out.itemId]?.name || out.itemId}</span>
                        <span class="rate">${fmtRate(out.ratePerMachine * step.machineCountRaw, out.itemId, gameData)}</span>
                    </div>`).join('')}
                </div>
            </div>
        </div>`;
    }

    let rawHTML = '';
    for (const [itemId, rate] of Object.entries(result.rawResources)) {
        const name = gameData.items[itemId]?.name || itemId;
        rawHTML += `<div class="step-flow-item" style="padding:6px 0">
            <div class="item-cell">
                ${itemIcon(itemId, gameData, 24)}
                <span>${name}</span>
            </div>
            <span class="rate" style="color:var(--accent-orange)">${fmtRate(rate, itemId, gameData)}</span>
        </div>`;
    }

    return `
    <div class="card" style="margin-bottom:16px">
        <div class="card-header">
            <div>
                <div class="card-title">Production Plan: ${targetName}</div>
                <div class="card-subtitle">${fmtRate(result.targetRate, result.targetItemId, gameData)} • ${result.totalMachines} machines • ${fmt(result.totalPower)} MW</div>
            </div>
            <button class="btn btn-secondary btn-sm" id="add-plan-to-factory">Add to Factory</button>
        </div>
    </div>
    <div class="card" style="margin-bottom:16px">
        <div class="card-title" style="margin-bottom:14px">Raw Resources Required</div>
        ${rawHTML || '<p style="color:var(--text-muted)">None</p>'}
    </div>
    <div class="card">
        <div class="card-title" style="margin-bottom:14px">Production Steps (${result.steps.length})</div>
        ${stepsHTML}
    </div>`;
}

function renderVisualizationTab() {
    return `<div class="card" style="padding:0;overflow:hidden">
        <canvas id="flowchart-canvas" style="width:100%;height:600px;display:block;cursor:grab"></canvas>
    </div>`;
}

function renderItemsTab(result, gameData) {
    // Collect all items used in the production chain
    const itemSummary = {};
    for (const step of result.steps) {
        for (const inp of step.inputs) {
            if (!itemSummary[inp.itemId]) itemSummary[inp.itemId] = { consumed: 0, produced: 0 };
            itemSummary[inp.itemId].consumed += inp.ratePerMachine * step.machineCountRaw;
        }
        for (const out of step.outputs) {
            if (!itemSummary[out.itemId]) itemSummary[out.itemId] = { consumed: 0, produced: 0 };
            itemSummary[out.itemId].produced += out.ratePerMachine * step.machineCountRaw;
        }
    }

    let rows = '';
    for (const [itemId, summary] of Object.entries(itemSummary).sort((a, b) => {
        const na = gameData.items[a[0]]?.name || a[0];
        const nb = gameData.items[b[0]]?.name || b[0];
        return na.localeCompare(nb);
    })) {
        const item = gameData.items[itemId];
        const net = summary.produced - summary.consumed;
        const netClass = net > 0.01 ? 'rate-surplus' : net < -0.01 ? 'rate-deficit' : 'rate-balanced';
        rows += `<tr>
            <td><div class="item-cell">
                ${itemIcon(itemId, gameData)}
                <span>${item?.name || itemId}</span>
            </div></td>
            <td class="rate-cell rate-surplus">${summary.produced > 0 ? fmtRate(summary.produced, itemId, gameData) : '-'}</td>
            <td class="rate-cell rate-deficit">${summary.consumed > 0 ? fmtRate(summary.consumed, itemId, gameData) : '-'}</td>
            <td class="rate-cell ${netClass}">${fmtRate(net, itemId, gameData)}</td>
        </tr>`;
    }

    return `<div class="card">
        <div class="card-title" style="margin-bottom:14px">Items in Production Chain</div>
        <div class="table-container" style="max-height:60vh;overflow-y:auto">
            <table>
                <thead><tr><th>Item</th><th>Produced</th><th>Consumed</th><th>Net</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
    </div>`;
}

export function initPlanner() {
    const calcBtn = document.getElementById('planner-calc');
    if (calcBtn) {
        calcBtn.addEventListener('click', async () => {
            const itemId = document.getElementById('planner-item').value;
            const rate = parseFloat(document.getElementById('planner-rate').value);
            if (!itemId) { showToast('Select an item', 'error'); return; }
            if (!rate || rate <= 0) { showToast('Enter a valid rate', 'error'); return; }

            plannerState.targetItem = itemId;
            plannerState.targetRate = rate;

            // Collect recipe overrides
            document.querySelectorAll('.recipe-override-select').forEach(sel => {
                if (sel.value) plannerState.recipeOverrides[sel.dataset.itemId] = sel.value;
                else delete plannerState.recipeOverrides[sel.dataset.itemId];
            });

            calcBtn.innerHTML = '<div class="loading-spinner" style="width:16px;height:16px;border-width:2px"></div> Calculating...';
            try {
                const result = await api.calculate(itemId, rate, plannerState.recipeOverrides);
                plannerState.result = result;
                plannerState.activeTab = 'overview';
                document.getElementById('page-content').innerHTML = renderPlanner();
                initPlanner();
            } catch (err) {
                showToast(err.message, 'error');
                calcBtn.textContent = 'Calculate Production Chain';
            }
        });
    }

    document.getElementById('planner-item')?.addEventListener('change', (e) => {
        plannerState.targetItem = e.target.value;
        plannerState.result = null;
        plannerState.recipeOverrides = {};
        document.getElementById('page-content').innerHTML = renderPlanner();
        initPlanner();
    });

    // Recipe override change → re-render overrides to cascade
    document.querySelectorAll('.recipe-override-select').forEach(sel => {
        sel.addEventListener('change', () => {
            // Update state
            if (sel.value) plannerState.recipeOverrides[sel.dataset.itemId] = sel.value;
            else delete plannerState.recipeOverrides[sel.dataset.itemId];
            // Re-render just the overrides panel to cascade
            const { gameData } = getState();
            const container = document.getElementById('recipe-overrides');
            if (container) {
                container.innerHTML = renderRecipeOverrides(gameData);
                // Re-attach change listeners
                container.querySelectorAll('.recipe-override-select').forEach(s => {
                    s.addEventListener('change', () => {
                        if (s.value) plannerState.recipeOverrides[s.dataset.itemId] = s.value;
                        else delete plannerState.recipeOverrides[s.dataset.itemId];
                        container.innerHTML = renderRecipeOverrides(gameData);
                        initOverrideListeners(container, gameData);
                    });
                });
            }
        });
    });

    // Tab switching
    document.querySelectorAll('.planner-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            plannerState.activeTab = tab.dataset.tab;
            document.getElementById('page-content').innerHTML = renderPlanner();
            initPlanner();
            // Init flowchart if visualization tab
            if (plannerState.activeTab === 'visualization' && plannerState.result) {
                const { gameData } = getState();
                setTimeout(() => initFlowchart(plannerState.result, gameData), 50);
            }
        });
    });

    // Init flowchart if already on visualization tab
    if (plannerState.activeTab === 'visualization' && plannerState.result) {
        const { gameData } = getState();
        setTimeout(() => initFlowchart(plannerState.result, gameData), 50);
    }

    // Add plan to factory button
    document.getElementById('add-plan-to-factory')?.addEventListener('click', async () => {
        if (!plannerState.result) return;
        const { gameData } = getState();
        const targetName = gameData.items[plannerState.result.targetItemId]?.name || 'Production';
        const buildings = plannerState.result.steps.map(step => ({
            recipeId: step.recipeId,
            buildingId: step.buildingId,
            count: step.machineCount,
            clockSpeed: step.clockSpeed
        }));

        try {
            await api.createFactory({
                name: `${targetName} Factory`,
                description: `${fmtRate(plannerState.result.targetRate, plannerState.result.targetItemId, gameData)} ${targetName}`,
                buildings
            });
            const updatedFactories = await api.getFactories();
            setState('factories', updatedFactories);
            showToast('Factory created from plan!', 'success');
        } catch (err) { showToast(err.message, 'error'); }
    });
}

function initOverrideListeners(container, gameData) {
    container.querySelectorAll('.recipe-override-select').forEach(s => {
        s.addEventListener('change', () => {
            if (s.value) plannerState.recipeOverrides[s.dataset.itemId] = s.value;
            else delete plannerState.recipeOverrides[s.dataset.itemId];
            container.innerHTML = renderRecipeOverrides(gameData);
            initOverrideListeners(container, gameData);
        });
    });
}
