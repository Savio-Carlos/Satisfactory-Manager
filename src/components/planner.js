import { getState, setState, showToast, fmt, fmtRate, itemIcon, buildingIcon, computeGlobalBalance, RAW_LIMITS } from '../modules/state.js';
import { api } from '../modules/api.js';
import { renderFlowchart, initFlowchart } from './flowchart.js';
import { showAddFactoryModal } from './factories.js';

let plannerState = {
    targets: [],          // [{itemId, rate, recipeOverrides:{}}]
    inputs: [],           // [{itemId}]
    result: null,
    activeTab: 'production',
    vizFullscreen: false,
    mode: 'rate',         // 'rate' | 'max'
    resourceLimits: null  // { itemId: rate } — populated lazily from RAW_LIMITS
};

export function renderPlanner() {
    const { gameData } = getState();
    if (!gameData) return '<div class="loading-overlay"><div class="loading-spinner"></div>Loading game data...</div>';

    const hasResult = plannerState.result && (
        (plannerState.result.steps && plannerState.result.steps.length > 0) ||
        (plannerState.result.rawResources && Object.keys(plannerState.result.rawResources).length > 0)
    );
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
    <div class="fade-in" style="display:flex;flex-direction:column;gap:16px;padding-bottom:100px">
        <div class="page-header" style="margin-bottom:0">
            <div>
                <h1>Production Planner</h1>
                <p>Design new factories and calculate resource requirements</p>
            </div>
            <div style="display:flex;gap:12px;align-items:center">
                 <div class="mode-toggle" style="display:flex;background:var(--bg-input);border:1px solid var(--border-color);border-radius:var(--radius-sm);overflow:hidden">
                    <button class="mode-toggle-btn ${plannerState.mode === 'rate' ? 'active' : ''}" data-mode="rate" style="padding:8px 14px;font-size:12px;font-weight:600;background:${plannerState.mode === 'rate' ? 'var(--accent-orange)' : 'transparent'};color:${plannerState.mode === 'rate' ? '#fff' : 'var(--text-secondary)'};border:none;cursor:pointer">Set Rate</button>
                    <button class="mode-toggle-btn ${plannerState.mode === 'max' ? 'active' : ''}" data-mode="max" style="padding:8px 14px;font-size:12px;font-weight:600;background:${plannerState.mode === 'max' ? 'var(--accent-orange)' : 'transparent'};color:${plannerState.mode === 'max' ? '#fff' : 'var(--text-secondary)'};border:none;cursor:pointer">Maximize</button>
                 </div>
                 <button class="btn btn-secondary" id="add-plan-to-factory" ${!hasResult ? 'disabled' : ''}>Add to Factory</button>
                 <button class="btn btn-primary" id="planner-calc" style="padding:12px 36px;font-size:16px;font-weight:700;height:auto">Calculate</button>
            </div>
        </div>
        
        <div class="planner-tabs">
            <button class="planner-tab ${tab === 'production' ? 'active' : ''}" data-tab="production">🏭 Production</button>
            <button class="planner-tab ${tab === 'recipes' ? 'active' : ''}" data-tab="recipes">📜 Recipes</button>
            <button class="planner-tab ${tab === 'items' ? 'active' : ''}" data-tab="items">📦 Items</button>
        </div>
        
        <div id="planner-tab-content">
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
    
    const dropdownItems = producibleItems.map(i => `
        <div class="custom-dropdown-item" data-value="${i.id}">
            ${itemIcon(i.id, gameData)}
            <span>${i.name}</span>
        </div>
    `).join('');

    const isMax = plannerState.mode === 'max';
    const maxRate = plannerState.result?.maxRate;
    const targetRows = plannerState.targets.map((t, idx) => {
        const item = gameData.items[t.itemId];
        const rateValue = isMax && maxRate ? maxRate.toFixed(2) : t.rate;
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
                <input type="number" class="target-rate-input" data-idx="${idx}" value="${rateValue}" min="0.1" step="0.1" ${isMax ? 'disabled' : ''} style="border-radius:var(--radius-sm);${isMax ? 'background:var(--bg-input);color:var(--text-muted)' : ''}" />
            </div>
            <div style="color:var(--text-secondary);font-size:13px;width:60px">items/min</div>
            <button class="btn btn-ghost btn-sm btn-remove-target" data-idx="${idx}" style="color:var(--accent-red);padding:0 12px;height:38px">✕</button>
        </div>`;
    }).join('');

    const globalBalance = computeGlobalBalance();
    const renderUsageBar = (rate, produced) => {
        if (!produced || produced <= 0) {
            return `<div style="font-size:10px;color:var(--text-muted)">no global production</div>`;
        }
        const pct = Math.max(0, (rate / produced) * 100);
        const visualPct = Math.min(100, pct);
        const color = pct > 100 ? 'var(--color-deficit)' : (pct > 80 ? 'var(--color-balanced)' : 'var(--color-surplus)');
        return `<div style="display:flex;align-items:center;gap:6px;margin-top:4px">
            <div style="flex:1;height:6px;background:var(--bg-input);border-radius:3px;overflow:hidden">
                <div style="height:100%;width:${visualPct}%;background:${color};transition:width 0.2s"></div>
            </div>
            <span style="font-size:10px;color:${color};font-family:var(--font-mono);min-width:42px;text-align:right">${pct < 0.05 ? '0' : pct.toFixed(pct < 10 ? 1 : 0)}%</span>
        </div>`;
    };
    const inputRows = plannerState.inputs.map((inp, idx) => {
        const item = gameData.items[inp.itemId];
        const b = globalBalance[inp.itemId];
        const produced = b?.produced || 0;
        const usageInfo = inp.itemId
            ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px;font-family:var(--font-mono)">Global produced: ${fmtRate(produced, inp.itemId, gameData)}</div>${renderUsageBar(inp.rate || 0, produced)}`
            : '';
        return `<div class="target-row" style="display:flex;gap:12px;margin-bottom:8px;align-items:flex-start">
            <div class="input-group" style="margin:0;flex:2">
                <div style="display:flex;align-items:center;background:var(--bg-input);border:1px solid var(--border-color);border-radius:var(--radius-sm);padding:0 8px">
                    ${item ? itemIcon(inp.itemId, gameData, 20) : ''}
                    <select class="input-item-select" data-idx="${idx}" style="border:none;background:transparent;flex:1;outline:none;padding-left:8px">
                        <option value="">Select item...</option>
                        ${producibleItems.map(i => `<option value="${i.id}" ${i.id === inp.itemId ? 'selected' : ''}>${i.name}</option>`).join('')}
                    </select>
                </div>
                ${usageInfo}
            </div>
            <div class="input-group" style="margin:0;flex:1;max-width:150px">
                <input type="number" class="input-rate-input" data-idx="${idx}" value="${inp.rate || 0}" min="0.1" step="0.1" style="border-radius:var(--radius-sm)" />
            </div>
            <div style="color:var(--text-secondary);font-size:13px;width:60px;padding-top:10px">items/min</div>
            <button class="btn btn-ghost btn-sm btn-remove-input" data-idx="${idx}" style="color:var(--accent-red);padding:0 12px;height:38px">✕</button>
        </div>`;
    }).join('');

    // Suggestions: ingredients from added products that aren't already inputs.
    const suggestionMap = new Map(); // itemId → {item, produced}
    for (const t of plannerState.targets) {
        if (!t.itemId) continue;
        const recipeIds = gameData.itemRecipeMap[t.itemId] || [];
        const recipeId = recipeIds.find(rId => {
            const r = gameData.recipes[rId];
            return !r.isAlternate && r.products[0]?.itemId === t.itemId;
        }) || recipeIds.find(rId => !gameData.recipes[rId].isAlternate) || recipeIds[0];
        if (!recipeId) continue;
        const recipe = gameData.recipes[recipeId];
        if (!recipe?.ingredients) continue;
        for (const ing of recipe.ingredients) {
            if (suggestionMap.has(ing.itemId)) continue;
            if (plannerState.inputs.some(i => i.itemId === ing.itemId)) continue;
            const b = globalBalance[ing.itemId];
            suggestionMap.set(ing.itemId, { produced: b?.produced || 0 });
        }
    }
    const suggestionRows = Array.from(suggestionMap.entries()).map(([itemId, info]) => {
        const item = gameData.items[itemId];
        const hasProduction = info.produced > 0.001;
        return `<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:var(--bg-input);border:1px solid var(--border-color);border-radius:var(--radius-sm);margin-bottom:6px">
            ${itemIcon(itemId, gameData, 18, 'item-icon-sm')}
            <span style="flex:1;font-size:12px">${item?.name || itemId}</span>
            <span style="font-size:11px;color:${hasProduction ? 'var(--color-surplus)' : 'var(--text-muted)'};font-family:var(--font-mono)">${fmtRate(info.produced, itemId, gameData)}</span>
            <button class="btn btn-ghost btn-sm suggestion-add-btn" data-item="${itemId}" data-produced="${info.produced}" style="padding:2px 8px;font-size:11px;height:22px;color:var(--accent-blue);border:1px solid var(--accent-blue)">+ Add</button>
        </div>`;
    }).join('');
    const suggestionsHtml = suggestionRows
        ? `<div style="margin-top:14px;padding-top:12px;border-top:1px dashed var(--border-color)">
            <div style="font-size:11px;font-weight:600;color:var(--text-secondary);margin-bottom:8px;text-transform:uppercase;letter-spacing:0.05em">Suggested from Products</div>
            ${suggestionRows}
           </div>`
        : '';

    // Resource Limits panel (only visible in maximize mode).
    if (!plannerState.resourceLimits) {
        plannerState.resourceLimits = {};
        for (const [itemId, limit] of Object.entries(RAW_LIMITS)) {
            if (isFinite(limit)) plannerState.resourceLimits[itemId] = limit;
        }
    }
    const limitRows = Object.entries(RAW_LIMITS)
        .filter(([, lim]) => isFinite(lim))
        .map(([itemId, mapLimit]) => {
            const item = gameData.items[itemId];
            const current = plannerState.resourceLimits[itemId] ?? mapLimit;
            return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
                ${itemIcon(itemId, gameData, 18, 'item-icon-sm')}
                <span style="flex:1;font-size:12px">${item?.name || itemId}</span>
                <input type="number" class="resource-limit-input" data-item="${itemId}" value="${current}" min="0" step="100" style="width:90px;padding:4px 6px;font-size:12px;font-family:var(--font-mono);text-align:right;background:var(--bg-input);border:1px solid var(--border-color);border-radius:var(--radius-sm);color:var(--text-primary)" />
                <button class="btn btn-ghost btn-sm reset-limit-btn" data-item="${itemId}" data-default="${mapLimit}" title="Reset to map default" style="padding:2px 6px;font-size:10px;height:22px">Reset</button>
            </div>`;
        }).join('');
    const resourceLimitsHtml = isMax ? `
        <div style="background:var(--bg-card);border:1px solid var(--border-color);border-radius:var(--radius-md);padding:16px;margin-bottom:16px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
                <div style="font-size:14px;font-weight:600;color:var(--text-secondary)">Resource Limits (items/min)</div>
                <button class="btn btn-ghost btn-sm" id="reset-all-limits" style="font-size:11px;padding:4px 10px">Reset all</button>
            </div>
            <div style="font-size:12px;color:var(--text-muted);margin-bottom:12px">Maximize will find the highest equal rate for all targets that doesn't exceed any of these raw resource limits.</div>
            <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px 24px">${limitRows}</div>
        </div>
    ` : '';
    const maxResultBanner = (isMax && maxRate)
        ? `<div style="background:var(--accent-orange);color:#fff;padding:10px 16px;border-radius:var(--radius-md);margin-bottom:16px;font-weight:600;font-size:14px">Maximum achievable: ${maxRate.toFixed(2)} items/min for each target</div>`
        : '';

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
    ${maxResultBanner}
    ${resourceLimitsHtml}
    <div style="display:flex;gap:16px;margin-bottom:16px">
        <div style="background:var(--bg-card);border:1px solid var(--border-color);border-radius:var(--radius-md);padding:16px;flex:1">
            <div style="margin-bottom:16px;font-size:14px;font-weight:600;color:var(--text-secondary)">Products (Outputs)</div>
            <div id="planner-target-list">
                ${targetRows}
            </div>
            <div style="display:flex;gap:12px;margin-top:8px">
                <div class="input-group custom-dropdown-container" style="margin:0;flex:2">
                    <input type="text" id="planner-new-item-search" placeholder="Search or select item..." autocomplete="off" />
                    <div class="custom-dropdown-menu" id="planner-item-menu">
                        ${dropdownItems}
                    </div>
                </div>
                <button class="btn btn-ghost" id="planner-add-target" style="flex:1;border:1px dashed var(--accent-green);color:var(--accent-green)">+ Add Product</button>
            </div>
        </div>
        
        <div style="background:var(--bg-card);border:1px solid var(--border-color);border-radius:var(--radius-md);padding:16px;flex:1">
            <div style="margin-bottom:16px;font-size:14px;font-weight:600;color:var(--text-secondary)">Available Inputs (Globally Sourced)</div>
            <div style="font-size:12px;color:var(--text-muted);margin-bottom:12px">These items will be drawn from your global surplus before being produced.</div>
            <div id="planner-input-list">
                ${inputRows}
            </div>
            <div style="display:flex;gap:12px;margin-top:8px">
                <div class="input-group custom-dropdown-container" style="margin:0;flex:2">
                    <input type="text" id="planner-new-input-search" placeholder="Search or select item..." autocomplete="off" />
                    <div class="custom-dropdown-menu" id="planner-input-menu">
                        ${dropdownItems}
                    </div>
                </div>
                <button class="btn btn-ghost" id="planner-add-input" style="flex:1;border:1px dashed var(--accent-blue);color:var(--accent-blue)">+ Add Input</button>
            </div>
            ${suggestionsHtml}
        </div>
    </div>
    
    <div style="height:850px;position:relative;background:var(--bg-card);border:1px solid var(--border-color);border-radius:var(--radius-md);overflow:hidden">
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
    let selectedItemId = null;

    // Mode toggle (Set Rate / Maximize)
    document.querySelectorAll('.mode-toggle-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const mode = btn.dataset.mode;
            if (mode === plannerState.mode) return;
            plannerState.mode = mode;
            plannerState.result = null;
            rerender();
        });
    });

    // Resource Limits inputs
    document.querySelectorAll('.resource-limit-input').forEach(input => {
        input.addEventListener('change', (e) => {
            const itemId = e.target.dataset.item;
            const val = parseFloat(e.target.value);
            if (isFinite(val) && val >= 0) {
                plannerState.resourceLimits[itemId] = val;
            }
        });
    });
    document.querySelectorAll('.reset-limit-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const itemId = btn.dataset.item;
            const def = parseFloat(btn.dataset.default);
            if (isFinite(def)) {
                plannerState.resourceLimits[itemId] = def;
                rerender();
            }
        });
    });
    document.getElementById('reset-all-limits')?.addEventListener('click', () => {
        plannerState.resourceLimits = {};
        for (const [itemId, limit] of Object.entries(RAW_LIMITS)) {
            if (isFinite(limit)) plannerState.resourceLimits[itemId] = limit;
        }
        rerender();
    });

    // Custom Dropdown logic
    const searchInput = document.getElementById('planner-new-item-search');
    const menu = document.getElementById('planner-item-menu');
    
    if (searchInput && menu) {
        searchInput.addEventListener('focus', () => menu.classList.add('show'));
        document.addEventListener('click', (e) => {
            if (!searchInput.contains(e.target) && !menu.contains(e.target)) {
                menu.classList.remove('show');
            }
        });
        
        searchInput.addEventListener('input', () => {
            const q = searchInput.value.toLowerCase();
            menu.querySelectorAll('.custom-dropdown-item').forEach(item => {
                const name = item.querySelector('span').textContent.toLowerCase();
                item.style.display = name.includes(q) ? 'flex' : 'none';
            });
            menu.classList.add('show');
        });
        
        menu.querySelectorAll('.custom-dropdown-item').forEach(item => {
            item.addEventListener('click', () => {
                selectedItemId = item.dataset.value;
                searchInput.value = item.querySelector('span').textContent;
                menu.classList.remove('show');
            });
        });
    }

    // Suggestion add buttons (ingredients of added products)
    document.querySelectorAll('.suggestion-add-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const itemId = btn.dataset.item;
            const produced = parseFloat(btn.dataset.produced) || 0;
            if (plannerState.inputs.find(i => i.itemId === itemId)) return;
            plannerState.inputs.push({ itemId, rate: produced > 0 ? produced : 10 });
            plannerState.result = null;
            rerender();
        });
    });

    // Add Input logic (Dropdown)
    let selectedInputId = null;
    const searchInputInput = document.getElementById('planner-new-input-search');
    const menuInput = document.getElementById('planner-input-menu');
    
    if (searchInputInput && menuInput) {
        searchInputInput.addEventListener('focus', () => menuInput.classList.add('show'));
        document.addEventListener('click', (e) => {
            if (!searchInputInput.contains(e.target) && !menuInput.contains(e.target)) {
                menuInput.classList.remove('show');
            }
        });
        
        searchInputInput.addEventListener('input', () => {
            const q = searchInputInput.value.toLowerCase();
            menuInput.querySelectorAll('.custom-dropdown-item').forEach(item => {
                const name = item.querySelector('span').textContent.toLowerCase();
                item.style.display = name.includes(q) ? 'flex' : 'none';
            });
            menuInput.classList.add('show');
        });
        
        menuInput.querySelectorAll('.custom-dropdown-item').forEach(item => {
            item.addEventListener('click', () => {
                selectedInputId = item.dataset.value;
                searchInputInput.value = item.querySelector('span').textContent;
                menuInput.classList.remove('show');
            });
        });
    }

    // Add target button
    document.getElementById('planner-add-target')?.addEventListener('click', () => {
        if (!selectedItemId) { showToast('Select an item', 'error'); return; }

        // Check if already added
        if (plannerState.targets.find(t => t.itemId === selectedItemId)) {
            showToast('Item already added', 'error'); return;
        }
        plannerState.targets.push({ itemId: selectedItemId, rate: 10, recipeOverrides: {} });
        selectedItemId = null;
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

    // Add input button
    document.getElementById('planner-add-input')?.addEventListener('click', () => {
        if (!selectedInputId) { showToast('Select an item', 'error'); return; }
        
        if (plannerState.inputs.find(i => i.itemId === selectedInputId)) {
            showToast('Input already added', 'error'); return;
        }
        
        const globalBalance = computeGlobalBalance();
        const b = globalBalance[selectedInputId];
        const surplus = b && (b.produced - b.consumed) > 0 ? (b.produced - b.consumed) : 0;
        
        plannerState.inputs.push({ itemId: selectedInputId, rate: surplus > 0 ? surplus : 10 });
        plannerState.result = null;
        rerender();
    });

    // Remove input
    document.querySelectorAll('.btn-remove-input').forEach(btn => {
        btn.addEventListener('click', () => {
            plannerState.inputs.splice(parseInt(btn.dataset.idx), 1);
            plannerState.result = null;
            rerender();
        });
    });

    // Update input properties
    document.querySelectorAll('.input-item-select').forEach(sel => {
        sel.addEventListener('change', (e) => {
            const idx = parseInt(e.target.dataset.idx);
            const val = e.target.value;
            if (val) {
                plannerState.inputs[idx].itemId = val;
                plannerState.result = null;
                rerender();
            }
        });
    });

    document.querySelectorAll('.input-rate-input').forEach(input => {
        input.addEventListener('change', (e) => {
            const idx = parseInt(e.target.dataset.idx);
            const val = parseFloat(e.target.value);
            if (val > 0) {
                plannerState.inputs[idx].rate = val;
                rerender();
            }
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
            const availableInputs = {};
            for (const inp of plannerState.inputs) {
                if (inp.rate > 0) {
                    availableInputs[inp.itemId] = inp.rate;
                }
            }

            // Maximize mode: ask server for the highest equal rate that fits resource limits.
            if (plannerState.mode === 'max') {
                const targetItemIds = plannerState.targets.map(t => t.itemId).filter(Boolean);
                if (targetItemIds.length === 0) { showToast('Add at least one item', 'error'); btn.textContent = 'Calculate'; return; }
                const resourceLimits = { ...plannerState.resourceLimits };
                const result = await api.calculateMax(targetItemIds, overrides, availableInputs, resourceLimits);
                if (result) {
                    result.targets = targetItemIds.map(id => ({ itemId: id, rate: result.maxRate || 0 }));
                    plannerState.result = result;
                    // Update target rates to reflect the maximized rate
                    for (const t of plannerState.targets) t.rate = result.maxRate || t.rate;
                }
                plannerState.activeTab = 'production';
                rerender();
                return;
            }

            // Calculate for each target and merge.
            // We pass a fresh copy of availableInputs each call and decrement our
            // local pool by what the server reported as raw (for sourced items),
            // so multi-target plans don't double-spend the global surplus.
            const remainingInputs = { ...availableInputs };
            let merged = null;
            for (const t of plannerState.targets) {
                const result = await api.calculate(t.itemId, t.rate, { ...overrides, ...t.recipeOverrides }, { ...remainingInputs });
                // Decrement remaining inputs by raw resources consumed for items in our pool
                for (const itemId of Object.keys(remainingInputs)) {
                    const used = result.rawResources?.[itemId] || 0;
                    remainingInputs[itemId] = Math.max(0, remainingInputs[itemId] - used);
                }
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
            if (merged) {
                merged.targets = plannerState.targets.map(t => ({ itemId: t.itemId, rate: t.rate }));
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

        // Carry the planner's available-inputs into the factory's sourcing map.
        // Use the chain's *actual* raw consumption for each sourced item — the
        // user-entered rate is just a cap; if the chain only needed 300 of the
        // 1000 they offered, source 300. Conversely, if Heat Sink really needs
        // 150 Alclad Sheets and the user offered 150, that's exactly what the
        // server consumed. Either way, raw[itemId] is the right number.
        const sourcedInputs = {};
        const raw = plannerState.result.rawResources || {};
        for (const inp of plannerState.inputs) {
            if (!inp.itemId) continue;
            const actualRate = Number(raw[inp.itemId]) || 0;
            if (actualRate > 0) sourcedInputs[inp.itemId] = actualRate;
        }

        showAddFactoryModal(`${names} Factory`, `Planned production`, buildings, sourcedInputs);
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
