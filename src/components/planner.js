import { getState, setState, showToast, fmt, fmtRate, itemIcon, buildingIcon } from '../modules/state.js';
import { api } from '../modules/api.js';
import { renderFlowchart, initFlowchart } from './flowchart.js';
import { showAddFactoryModal } from './factories.js';

let plannerState = {
    targets: [],          // [{itemId, rate, recipeOverrides:{}}]
    result: null,
    activeTab: 'production',
    vizFullscreen: false
};

export function renderPlanner() {
    const { gameData } = getState();
    if (!gameData) return '<div class="loading-overlay"><div class="loading-spinner"></div>Loading game data...</div>';

    const hasResult = !!plannerState.result;
    const tab = plannerState.activeTab;

    // Visualization fullscreen
    if (tab === 'production' && plannerState.vizFullscreen && hasResult) {
        return `<div class="planner-viz-fullscreen" id="planner-viz-fs">
            <div class="planner-viz-back"><button class="btn btn-secondary btn-sm" id="viz-exit-fs">← Back</button></div>
            <canvas id="flowchart-canvas"></canvas>
        </div>`;
    }

    let resultContent = '';
    
    if (tab === 'production') {
        resultContent = renderProductionTab(gameData, hasResult);
    } else if (tab === 'recipes') {
        resultContent = renderRecipesTab(gameData, hasResult);
    } else if (tab === 'items') {
        resultContent = renderItemsTab(plannerState.result, gameData, hasResult);
    }

    return `
    <div class="fade-in" style="height:calc(100vh - 100px);display:flex;flex-direction:column">
        <div class="page-header" style="margin-bottom:16px;flex:none">
            <div>
                <h1>Production Planner</h1>
                <p>Design new factories and calculate resource requirements</p>
            </div>
            <div style="display:flex;gap:12px;align-items:center">
                 <button class="btn btn-secondary" id="add-plan-to-factory" ${!hasResult ? 'disabled' : ''}>Add to Factory</button>
                 <button class="btn btn-primary" id="planner-calc" style="padding:0 24px">Calculate</button>
            </div>
        </div>
        
        <div class="planner-tabs" style="flex:none">
            <button class="planner-tab ${tab === 'production' ? 'active' : ''}" data-tab="production">🏭 Production</button>
            <button class="planner-tab ${tab === 'recipes' ? 'active' : ''}" data-tab="recipes">📜 Recipes</button>
            <button class="planner-tab ${tab === 'items' ? 'active' : ''}" data-tab="items">📦 Items</button>
        </div>
        
        <div id="planner-tab-content" style="flex:1;display:flex;flex-direction:column;min-height:0">
            ${resultContent}
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

function renderProductionTab(gameData, hasResult) {
    const producibleItems = Object.entries(gameData.itemRecipeMap)
        .map(([itemId]) => ({ id: itemId, name: gameData.items[itemId]?.name || itemId }))
        .sort((a, b) => a.name.localeCompare(b.name));
    
    const itemOptions = producibleItems.map(i => `<option value="${i.id}">${i.name}</option>`).join('');

    const targetRows = plannerState.targets.map((t, idx) => {
        const item = gameData.items[t.itemId];
        return `<div class="target-row" style="display:flex;gap:12px;margin-bottom:8px;align-items:center">
            <div class="input-group" style="margin:0;flex:2">
                <div style="display:flex;align-items:center;background:var(--bg-input);border:1px solid var(--border-color);border-radius:var(--radius-sm);padding:0 8px">
                    ${item ? itemIcon(t.itemId, gameData, 20) : ''}
                    <select class="target-item-select" data-idx="${idx}" style="border:none;background:transparent;flex:1;outline:none;padding-left:8px">
                        <option value="">Select item...</option>
                        ${producibleItems.map(i => `<option value="${i.id}" ${i.id === t.itemId ? 'selected' : ''}>${i.name}</option>`).join('')}
                    </select>
                </div>
            </div>
            <div class="input-group" style="margin:0;flex:1;max-width:150px">
                <input type="number" class="target-rate-input" data-idx="${idx}" value="${t.rate}" min="0.1" step="0.1" style="border-radius:var(--radius-sm)" />
            </div>
            <div style="color:var(--text-secondary);font-size:13px;width:60px">items/min</div>
            <button class="btn btn-ghost btn-sm btn-remove-target" data-idx="${idx}" style="color:var(--accent-red);padding:0 12px;height:38px">✕</button>
        </div>`;
    }).join('');

    let vizContent = '';
    if (!hasResult) {
        vizContent = `<div class="empty-state" style="height:100%;justify-content:center">
            <div class="empty-state-icon">🔧</div>
            <h3>No production plan yet</h3>
            <p>Add target items and click Calculate to view the visualization.</p>
        </div>`;
    } else {
        vizContent = `<div style="position:absolute;top:8px;right:8px;z-index:10">
            <button class="btn btn-secondary btn-sm" id="viz-fullscreen">⛶ Fullscreen</button>
        </div>
        <canvas id="flowchart-canvas" style="width:100%;height:100%;display:block;cursor:grab"></canvas>`;
    }

    return `
    <div style="flex:none;background:var(--bg-card);border:1px solid var(--border-color);border-radius:var(--radius-md);padding:16px;margin-bottom:16px">
        <div style="margin-bottom:16px;font-size:14px;font-weight:600;color:var(--text-secondary)">Select items you want to produce</div>
        <div id="planner-target-list">
            ${targetRows}
        </div>
        <div style="display:flex;gap:12px;margin-top:8px">
            <div class="input-group" style="margin:0;flex:2">
                <select id="planner-new-item">
                    <option value="">Search or select item...</option>
                    ${itemOptions}
                </select>
            </div>
            <button class="btn btn-ghost" id="planner-add-target" style="flex:1;border:1px dashed var(--accent-green);color:var(--accent-green)">+ Add product</button>
        </div>
    </div>
    <div style="flex:1;min-height:300px;position:relative;background:var(--bg-card);border:1px solid var(--border-color);border-radius:var(--radius-md);overflow:hidden">
        ${vizContent}
    </div>`;
}

function renderRecipesTab(gameData, hasResult) {
    if (plannerState.targets.length === 0) {
        return `<div class="empty-state"><p>Add items in the Production tab first.</p></div>`;
    }

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

    if (itemsWithAlts.size === 0) {
        return `<div class="empty-state"><p>No alternate recipes available for this production chain.</p></div>`;
    }

    let rows = '';
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
        
        rows += `<tr>
            <td style="width:250px"><div class="item-cell">${itemIcon(itemId, gameData, 20)}<span>${itemName}</span></div></td>
            <td>
                <select class="recipe-override-select" data-item-id="${itemId}" style="max-width:400px">
                    <option value="">Default Recipe</option>
                    ${options}
                </select>
            </td>
        </tr>`;
    }

    return `<div class="card" style="flex:1;overflow:hidden;display:flex;flex-direction:column">
        <div class="card-title" style="margin-bottom:16px;flex:none">Recipe Selection</div>
        <p style="color:var(--text-secondary);font-size:14px;margin-bottom:16px;flex:none">Select which recipes you want to allow for the current production chain.</p>
        <div class="table-container" style="flex:1;overflow-y:auto" id="recipe-overrides">
            <table>
                <thead><tr><th>Item</th><th>Selected Recipe</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
    </div>`;
}

function renderItemsTab(result, gameData, hasResult) {
    if (!hasResult) {
        return `<div class="empty-state"><p>Calculate the plan to see items.</p></div>`;
    }

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

    return `<div class="card" style="flex:1;overflow:hidden;display:flex;flex-direction:column">
        <div class="card-title" style="margin-bottom:14px;flex:none">Items in Production Chain</div>
        <div class="table-container" style="flex:1;overflow-y:auto">
            <table><thead><tr><th>Item</th><th>Produced</th><th>Consumed</th><th>Net</th></tr></thead>
            <tbody>${rows}</tbody></table>
        </div>
    </div>`;
}

export function initPlanner() {
    // Add target button
    document.getElementById('planner-add-target')?.addEventListener('click', () => {
        const itemSelect = document.getElementById('planner-new-item');
        if (!itemSelect) return;
        const itemId = itemSelect.value;
        if (!itemId) { showToast('Select an item', 'error'); return; }
        // Check if already added
        if (plannerState.targets.find(t => t.itemId === itemId)) {
            showToast('Item already added', 'error'); return;
        }
        plannerState.targets.push({ itemId, rate: 10, recipeOverrides: {} });
        plannerState.result = null;
        rerender();
    });

    // Remove target
    document.querySelectorAll('.btn-remove-target').forEach(btn => {
        btn.addEventListener('click', () => {
            plannerState.targets.splice(parseInt(btn.dataset.idx), 1);
            plannerState.result = null;
            rerender();
        });
    });

    // Update target properties
    document.querySelectorAll('.target-item-select').forEach(sel => {
        sel.addEventListener('change', (e) => {
            const idx = parseInt(e.target.dataset.idx);
            const val = e.target.value;
            if (val) {
                plannerState.targets[idx].itemId = val;
                plannerState.result = null;
            }
        });
    });
    
    document.querySelectorAll('.target-rate-input').forEach(input => {
        input.addEventListener('change', (e) => {
            const idx = parseInt(e.target.dataset.idx);
            const val = parseFloat(e.target.value);
            if (val > 0) {
                plannerState.targets[idx].rate = val;
            }
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
            plannerState.activeTab = 'production';
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
            if (plannerState.activeTab === 'production' && plannerState.result) {
                const { gameData } = getState();
                setTimeout(() => initFlowchart(plannerState.result, gameData), 50);
            }
        });
    });

    // Init flowchart if on production tab
    if (plannerState.activeTab === 'production' && plannerState.result) {
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
        if (plannerState.activeTab === 'production' && plannerState.result) {
            const { gameData } = getState();
            setTimeout(() => initFlowchart(plannerState.result, gameData), 50);
        }
    });

    // Add plan to factory
    document.getElementById('add-plan-to-factory')?.addEventListener('click', () => {
        if (!plannerState.result) return;
        const { gameData } = getState();
        const names = plannerState.targets.map(t => gameData.items[t.itemId]?.name || 'Item').join(' + ');
        const buildings = plannerState.result.steps.map(step => ({
            recipeId: step.recipeId, buildingId: step.buildingId,
            count: step.machineCount, clockSpeed: step.clockSpeed
        }));
        
        showAddFactoryModal(`${names} Factory`, `Planned production`, buildings);
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
            // re-render not needed immediately, just saves state. User clicks calculate to apply.
        });
    });
}

function rerender() {
    document.getElementById('page-content').innerHTML = renderPlanner();
    initPlanner();
}
