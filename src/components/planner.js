import { getState, setState, showToast, fmt, fmtRate, itemIcon, buildingIcon } from '../modules/state.js';
import { api } from '../modules/api.js';
import { renderFlowchart, initFlowchart } from './flowchart.js';

let plannerState = {
    targets: [],          // [{itemId, rate, recipeOverrides:{}}]
    result: null,
    activeTab: 'overview',
    vizFullscreen: false
};

export function renderPlanner() {
    const { gameData } = getState();
    if (!gameData) return '<div class="loading-overlay"><div class="loading-spinner"></div>Loading game data...</div>';

    const producibleItems = Object.entries(gameData.itemRecipeMap)
        .map(([itemId]) => ({ id: itemId, name: gameData.items[itemId]?.name || itemId }))
        .sort((a, b) => a.name.localeCompare(b.name));
    const itemOptions = producibleItems
        .map(i => `<option value="${i.id}">${i.name}</option>`).join('');

    // Target pills
    const pillsHTML = plannerState.targets.map((t, idx) => {
        const name = gameData.items[t.itemId]?.name || t.itemId;
        return `<span class="planner-target-pill">
            ${itemIcon(t.itemId, gameData, 18, 'item-icon-sm')}
            ${name} — ${fmtRate(t.rate, t.itemId, gameData)}
            <span class="pill-remove" data-idx="${idx}">✕</span>
        </span>`;
    }).join('');

    const hasResult = !!plannerState.result;
    const tab = plannerState.activeTab;

    // Visualization fullscreen
    if (tab === 'visualization' && plannerState.vizFullscreen && hasResult) {
        return `<div class="planner-viz-fullscreen" id="planner-viz-fs">
            <div class="planner-viz-back"><button class="btn btn-secondary btn-sm" id="viz-exit-fs">← Back</button></div>
            <canvas id="flowchart-canvas"></canvas>
        </div>`;
    }

    let resultContent = '';
    if (!hasResult) {
        resultContent = `<div class="empty-state">
            <div class="empty-state-icon">🔧</div>
            <h3>Add items to produce</h3>
            <p>Select target items and desired rates above, then click Calculate to see the full production chain.</p>
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
            <div><h1>Production Planner</h1><p>Design new factories and calculate resource requirements</p></div>
        </div>
        <div class="planner-config-bar">
            <div class="input-group" style="flex:2;min-width:200px">
                <label>Add Item</label>
                <select id="planner-item"><option value="">Select item...</option>${itemOptions}</select>
            </div>
            <div class="input-group" style="flex:1;min-width:100px">
                <label>Rate</label>
                <input type="number" id="planner-rate" value="10" min="0.1" step="0.1" />
            </div>
            <button class="btn btn-secondary btn-sm" id="planner-add-target" style="height:38px">+ Add</button>
            <button class="btn btn-primary btn-sm" id="planner-calc" style="height:38px">Calculate</button>
        </div>
        ${plannerState.targets.length > 0 ? `<div class="planner-targets">${pillsHTML}</div>` : ''}
        <div class="planner-body">
            <div class="planner-main" id="planner-results">${resultContent}</div>
            <div class="planner-sidebar">
                ${plannerState.targets.length > 0 ? `
                <div class="card">
                    <div class="card-title" style="margin-bottom:12px">Recipe Selection</div>
                    <div class="card-subtitle" style="margin-bottom:12px">Choose preferred recipes for each step</div>
                    <div id="recipe-overrides">${renderRecipeOverrides(gameData)}</div>
                </div>` : ''}
                ${hasResult ? renderAltRecipesSummary(plannerState.result, gameData) : ''}
            </div>
        </div>
    </div>`;
}

function getGlobalOverrides() {
    const merged = {};
    for (const t of plannerState.targets) {
        Object.assign(merged, t.recipeOverrides || {});
    }
    return merged;
}

function renderRecipeOverrides(gameData) {
    if (plannerState.targets.length === 0) return '';
    const { unlockedAlternates } = getState();
    const overrides = getGlobalOverrides();

    const itemsWithAlts = new Set();
    function findItems(itemId, visited = new Set()) {
        if (visited.has(itemId)) return;
        visited.add(itemId);
        const recipes = gameData.itemRecipeMap[itemId];
        if (!recipes || recipes.length === 0) return;
        if (recipes.length > 1) itemsWithAlts.add(itemId);
        let selectedRecipeId = overrides[itemId];
        if (!selectedRecipeId) {
            selectedRecipeId = recipes.find(rId => !gameData.recipes[rId]?.isAlternate) || recipes[0];
        }
        const recipe = gameData.recipes[selectedRecipeId];
        if (recipe && recipe.manufacturingDuration > 0) {
            for (const ing of recipe.ingredients) findItems(ing.itemId, visited);
        }
    }
    for (const t of plannerState.targets) findItems(t.itemId);

    if (itemsWithAlts.size === 0) return '<p style="color:var(--text-muted);font-size:12px">No alternate recipes available.</p>';

    let html = '';
    for (const itemId of itemsWithAlts) {
        const recipes = gameData.itemRecipeMap[itemId];
        const itemName = gameData.items[itemId]?.name || itemId;
        const currentOverride = overrides[itemId] || '';
        const options = recipes.map(rId => {
            const r = gameData.recipes[rId];
            const unlocked = !r.isAlternate || (unlockedAlternates || []).includes(rId);
            const label = r.name + (r.isAlternate ? (unlocked ? ' ★' : ' 🔒') : '');
            return `<option value="${rId}" ${rId === currentOverride ? 'selected' : ''}>${label}</option>`;
        }).join('');
        html += `<div class="input-group" style="margin-bottom:10px">
            <label style="display:flex;align-items:center;gap:4px">${itemIcon(itemId, gameData, 16, 'item-icon-sm')} ${itemName}</label>
            <select class="recipe-override-select" data-item-id="${itemId}">
                <option value="">Default</option>${options}
            </select>
        </div>`;
    }
    return html;
}

function renderAltRecipesSummary(result, gameData) {
    const altRecipes = result.steps.filter(s => gameData.recipes[s.recipeId]?.isAlternate);
    if (altRecipes.length === 0) return '';
    return `<div class="alt-recipes-summary" style="margin-top:16px">
        <div class="title">⭐ Alternate Recipes Used (${altRecipes.length})</div>
        ${altRecipes.map(s => `<div class="alt-item">• ${s.recipeName}</div>`).join('')}
    </div>`;
}

function renderOverviewTab(result, gameData) {
    const targetName = gameData.items[result.targetItemId]?.name || result.targetItemId;

    let stepsHTML = '';
    for (const step of result.steps) {
        const building = step.buildingId ? gameData.buildings[step.buildingId] : null;
        const recipe = gameData.recipes[step.recipeId];
        const isAlt = recipe?.isAlternate;
        stepsHTML += `<div class="production-step">
            <div class="step-header">
                <span class="step-machine">
                    ${buildingIcon(step.buildingId, gameData, 24)}
                    ${building?.name || 'Unknown'} — ${step.recipeName}
                    ${isAlt ? '<span class="badge badge-alt" style="margin-left:6px">ALT</span>' : ''}
                </span>
                <span class="step-count">×${step.machineCount} @ ${fmt(step.clockSpeed)}%</span>
            </div>
            <div class="step-flows">
                <div class="step-flow">
                    <div class="step-flow-title">Inputs</div>
                    ${step.inputs.map(inp => `<div class="step-flow-item">
                        <div class="item-cell">${itemIcon(inp.itemId, gameData, 18, 'item-icon-sm')}<span>${gameData.items[inp.itemId]?.name || inp.itemId}</span></div>
                        <span class="rate">${fmtRate(inp.ratePerMachine * step.machineCountRaw, inp.itemId, gameData)}</span>
                    </div>`).join('')}
                </div>
                <div class="step-flow">
                    <div class="step-flow-title">Outputs</div>
                    ${step.outputs.map(out => `<div class="step-flow-item">
                        <div class="item-cell">${itemIcon(out.itemId, gameData, 18, 'item-icon-sm')}<span>${gameData.items[out.itemId]?.name || out.itemId}</span></div>
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
            <div class="item-cell">${itemIcon(itemId, gameData, 24)}<span>${name}</span></div>
            <span class="rate" style="color:var(--accent-orange)">${fmtRate(rate, itemId, gameData)}</span>
        </div>`;
    }

    return `
    <div class="card" style="margin-bottom:16px">
        <div class="card-header">
            <div>
                <div class="card-title">Production Plan</div>
                <div class="card-subtitle">${result.totalMachines} machines • ${fmt(result.totalPower)} MW</div>
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
    return `<div style="display:flex;justify-content:flex-end;margin-bottom:8px">
        <button class="btn btn-secondary btn-sm" id="viz-fullscreen">⛶ Fullscreen</button>
    </div>
    <div class="card" style="padding:0;overflow:hidden">
        <canvas id="flowchart-canvas" style="width:100%;height:600px;display:block;cursor:grab"></canvas>
    </div>`;
}

function renderItemsTab(result, gameData) {
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
        return (gameData.items[a[0]]?.name || a[0]).localeCompare(gameData.items[b[0]]?.name || b[0]);
    })) {
        const item = gameData.items[itemId];
        const net = summary.produced - summary.consumed;
        const netClass = net > 0.01 ? 'rate-surplus' : net < -0.01 ? 'rate-deficit' : 'rate-balanced';
        rows += `<tr>
            <td><div class="item-cell">${itemIcon(itemId, gameData)}<span>${item?.name || itemId}</span></div></td>
            <td class="rate-cell rate-surplus">${summary.produced > 0 ? fmtRate(summary.produced, itemId, gameData) : '-'}</td>
            <td class="rate-cell rate-deficit">${summary.consumed > 0 ? fmtRate(summary.consumed, itemId, gameData) : '-'}</td>
            <td class="rate-cell ${netClass}">${fmtRate(net, itemId, gameData)}</td>
        </tr>`;
    }

    return `<div class="card">
        <div class="card-title" style="margin-bottom:14px">Items in Production Chain</div>
        <div class="table-container" style="max-height:60vh;overflow-y:auto">
            <table><thead><tr><th>Item</th><th>Produced</th><th>Consumed</th><th>Net</th></tr></thead>
            <tbody>${rows}</tbody></table>
        </div>
    </div>`;
}

export function initPlanner() {
    // Add target button
    document.getElementById('planner-add-target')?.addEventListener('click', () => {
        const itemId = document.getElementById('planner-item').value;
        const rate = parseFloat(document.getElementById('planner-rate').value);
        if (!itemId) { showToast('Select an item', 'error'); return; }
        if (!rate || rate <= 0) { showToast('Enter a valid rate', 'error'); return; }
        // Check if already added
        if (plannerState.targets.find(t => t.itemId === itemId)) {
            showToast('Item already added', 'error'); return;
        }
        plannerState.targets.push({ itemId, rate, recipeOverrides: {} });
        plannerState.result = null;
        rerender();
    });

    // Remove target pills
    document.querySelectorAll('.pill-remove').forEach(btn => {
        btn.addEventListener('click', () => {
            plannerState.targets.splice(parseInt(btn.dataset.idx), 1);
            plannerState.result = null;
            rerender();
        });
    });

    // Calculate
    document.getElementById('planner-calc')?.addEventListener('click', async () => {
        if (plannerState.targets.length === 0) { showToast('Add at least one item', 'error'); return; }
        const overrides = getGlobalOverrides();
        const btn = document.getElementById('planner-calc');
        btn.innerHTML = '<div class="loading-spinner" style="width:14px;height:14px;border-width:2px"></div>';

        try {
            // Calculate for each target and merge
            let merged = null;
            for (const t of plannerState.targets) {
                const result = await api.calculate(t.itemId, t.rate, { ...overrides, ...t.recipeOverrides });
                if (!merged) { merged = result; }
                else {
                    // Merge steps
                    for (const step of result.steps) {
                        const existing = merged.steps.find(s => s.recipeId === step.recipeId && s.targetItemId === step.targetItemId);
                        if (existing) {
                            existing.machineCountRaw += step.machineCountRaw;
                            existing.machineCount = Math.ceil(existing.machineCountRaw);
                            existing.clockSpeed = Math.round((existing.machineCountRaw / existing.machineCount) * 10000) / 100;
                        } else {
                            merged.steps.push(step);
                        }
                    }
                    // Merge raw resources
                    for (const [itemId, rate] of Object.entries(result.rawResources)) {
                        merged.rawResources[itemId] = (merged.rawResources[itemId] || 0) + rate;
                    }
                    merged.totalPower += result.totalPower;
                    merged.totalMachines = merged.steps.reduce((sum, s) => sum + s.machineCount, 0);
                }
            }
            plannerState.result = merged;
            plannerState.activeTab = 'overview';
            rerender();
        } catch (err) {
            showToast(err.message, 'error');
            btn.textContent = 'Calculate';
        }
    });

    // Recipe overrides
    initOverrideListeners();

    // Tab switching
    document.querySelectorAll('.planner-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            plannerState.activeTab = tab.dataset.tab;
            rerender();
            if (plannerState.activeTab === 'visualization' && plannerState.result) {
                const { gameData } = getState();
                setTimeout(() => initFlowchart(plannerState.result, gameData), 50);
            }
        });
    });

    // Init flowchart if on viz tab
    if (plannerState.activeTab === 'visualization' && plannerState.result) {
        const { gameData } = getState();
        setTimeout(() => initFlowchart(plannerState.result, gameData), 50);
    }

    // Fullscreen viz
    document.getElementById('viz-fullscreen')?.addEventListener('click', () => {
        plannerState.vizFullscreen = true;
        rerender();
        const { gameData } = getState();
        setTimeout(() => initFlowchart(plannerState.result, gameData), 50);
    });
    document.getElementById('viz-exit-fs')?.addEventListener('click', () => {
        plannerState.vizFullscreen = false;
        rerender();
        if (plannerState.activeTab === 'visualization' && plannerState.result) {
            const { gameData } = getState();
            setTimeout(() => initFlowchart(plannerState.result, gameData), 50);
        }
    });

    // Add plan to factory
    document.getElementById('add-plan-to-factory')?.addEventListener('click', async () => {
        if (!plannerState.result) return;
        const { gameData } = getState();
        const names = plannerState.targets.map(t => gameData.items[t.itemId]?.name || 'Item').join(' + ');
        const buildings = plannerState.result.steps.map(step => ({
            recipeId: step.recipeId, buildingId: step.buildingId,
            count: step.machineCount, clockSpeed: step.clockSpeed
        }));
        try {
            await api.createFactory({ name: `${names} Factory`, description: `Planned production`, buildings });
            const updatedFactories = await api.getFactories();
            setState('factories', updatedFactories);
            showToast('Factory created from plan!', 'success');
        } catch (err) { showToast(err.message, 'error'); }
    });
}

function initOverrideListeners() {
    const container = document.getElementById('recipe-overrides');
    if (!container) return;
    container.querySelectorAll('.recipe-override-select').forEach(sel => {
        sel.addEventListener('change', () => {
            // Update all target overrides
            for (const t of plannerState.targets) {
                if (sel.value) t.recipeOverrides[sel.dataset.itemId] = sel.value;
                else delete t.recipeOverrides[sel.dataset.itemId];
            }
            const { gameData } = getState();
            container.innerHTML = renderRecipeOverrides(gameData);
            initOverrideListeners();
        });
    });
}

function rerender() {
    document.getElementById('page-content').innerHTML = renderPlanner();
    initPlanner();
}
