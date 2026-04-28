import { getState, setState, showToast, showModal, hideModal, fmt, fmtRate, itemIcon, buildingIcon, renderProgressBar, computeGlobalBalance } from '../modules/state.js';
import { api } from '../modules/api.js';
import { initFlowchart } from './flowchart.js';

let activeFactoryId = null;
let activeTab = 'overview';
let factoryResultCache = null; // Cache for flowchart & materials

export function renderFactories() {
    if (activeFactoryId) return renderFactoryDetail();

    const { factories, gameData } = getState();

    let cards = '';
    if (factories.length === 0) {
        cards = `<div class="empty-state">
            <div class="empty-state-icon">🏭</div>
            <h3>No factories yet</h3>
            <p>Create your first factory to start tracking production. You can manually add buildings and recipes.</p>
            <button class="btn btn-primary" id="add-factory-empty">+ Add Factory</button>
        </div>`;
    } else {
        cards = '<div class="factory-grid">';
        for (const f of factories) {
            const buildingCount = (f.buildings || []).reduce((s, b) => s + (b.count || 1), 0);
            
            // Calculate total power and main outputs
            let totalPower = 0;
            const outputs = {};
            for (const bld of (f.buildings || [])) {
                if (bld.buildingId && gameData.buildings[bld.buildingId]) {
                    totalPower += (gameData.buildings[bld.buildingId].powerUsed || 0) * (bld.count || 1);
                }
                const recipe = gameData.recipes[bld.recipeId];
                if (recipe) {
                    for (const p of recipe.products) {
                        outputs[p.itemId] = true;
                    }
                }
            }
            
            const mainOutputsHtml = Object.keys(outputs).slice(0, 4).map(id => itemIcon(id, gameData, 20, 'item-icon-sm')).join('');
            const saveTag = f.countedInSave ? '<span class="badge badge-info" style="margin-left:8px;font-size:10px">From Save</span>' : '';
            
            cards += `<div class="factory-card" data-factory-id="${f.id}">
                <div class="factory-card-header">
                    <div class="factory-card-name">${f.name}${saveTag}</div>
                    <button class="btn btn-ghost btn-sm btn-delete-factory" data-id="${f.id}" title="Delete">🗑️</button>
                </div>
                ${f.description ? `<div class="factory-card-desc">${f.description}</div>` : ''}
                <div class="factory-card-stats">
                    <div class="factory-card-stat"><strong>${buildingCount}</strong> buildings</div>
                    <div class="factory-card-stat"><strong>${fmt(totalPower)}</strong> MW</div>
                </div>
                ${mainOutputsHtml ? `<div class="factory-card-items" style="margin-top:12px">${mainOutputsHtml}</div>` : ''}
            </div>`;
        }
        cards += '</div>';
    }

    return `
    <div class="fade-in">
        <div class="page-header">
            <div>
                <h1>Factories</h1>
                <p>Manage your production facilities</p>
            </div>
            <button class="btn btn-primary" id="add-factory-btn">+ Add Factory</button>
        </div>
        ${cards}
    </div>`;
}

function computeFactoryResult(factory, gameData) {
    const steps = [];
    let totalPower = 0;
    
    // Group identical buildings/recipes
    const grouped = {};
    for (const bld of (factory.buildings || [])) {
        const key = `${bld.recipeId}__${bld.buildingId}__${bld.clockSpeed}`;
        if (!grouped[key]) grouped[key] = { ...bld, count: 0 };
        grouped[key].count += (bld.count || 1);
    }

    for (const bld of Object.values(grouped)) {
        const recipe = gameData.recipes[bld.recipeId];
        if (!recipe) continue;
        
        const cyclesPerMinute = recipe.manufacturingDuration > 0 ? 60 / recipe.manufacturingDuration : 0;
        const clockMult = (bld.clockSpeed || 100) / 100;
        
        steps.push({
            recipeId: bld.recipeId,
            recipeName: recipe.name,
            targetItemId: recipe.products[0]?.itemId || 'unknown',
            machineCountRaw: bld.count,
            machineCount: bld.count,
            clockSpeed: bld.clockSpeed || 100,
            buildingId: bld.buildingId,
            inputs: recipe.ingredients.map(ing => ({
                itemId: ing.itemId,
                ratePerMachine: ing.amount * cyclesPerMinute * clockMult
            })),
            outputs: recipe.products.map(prod => ({
                itemId: prod.itemId,
                ratePerMachine: prod.amount * cyclesPerMinute * clockMult
            }))
        });
        
        if (bld.buildingId && gameData.buildings[bld.buildingId]) {
            totalPower += (gameData.buildings[bld.buildingId].powerUsed || 0) * bld.count * Math.pow(clockMult, 1.6); // approximate power scaling
        }
    }
    
    // Calculate raw resources (inputs that are not produced by any step)
    const producedItems = new Set();
    for (const step of steps) {
        for (const out of step.outputs) producedItems.add(out.itemId);
    }
    
    const rawResources = {};
    for (const step of steps) {
        for (const inp of step.inputs) {
            if (!producedItems.has(inp.itemId)) {
                rawResources[inp.itemId] = (rawResources[inp.itemId] || 0) + (inp.ratePerMachine * step.machineCount);
            }
        }
    }

    return {
        targetItemId: steps.length > 0 ? steps[steps.length - 1].targetItemId : null,
        targetRate: 0,
        steps,
        rawResources,
        totalPower,
        totalMachines: steps.reduce((sum, s) => sum + s.machineCount, 0)
    };
}

function renderFactoryDetail() {
    const { factories, gameData, unlockedAlternates } = getState();
    const factory = factories.find(f => f.id === activeFactoryId);
    if (!factory) {
        activeFactoryId = null;
        return renderFactories();
    }
    
    if (!factoryResultCache) {
        factoryResultCache = computeFactoryResult(factory, gameData);
    }

    const producibleItems = Object.entries(gameData.itemRecipeMap)
        .map(([itemId]) => ({ id: itemId, name: gameData.items[itemId]?.name || itemId }))
        .sort((a, b) => a.name.localeCompare(b.name));
    const itemOptions = producibleItems.map(i => `<option value="${i.id}">${i.name}</option>`).join('');

    let tabContent = '';
    
    if (activeTab === 'overview') {
        let buildingsHTML = '';
        for (const [i, bld] of (factory.buildings || []).entries()) {
            const recipe = gameData.recipes[bld.recipeId];
            const building = bld.buildingId ? gameData.buildings[bld.buildingId] : null;
            buildingsHTML += `<div class="production-step">
                <div class="step-header">
                    <span class="step-machine">
                        ${buildingIcon(bld.buildingId, gameData, 24)}
                        ${building?.name || 'Unknown'} — ${recipe?.name || 'No recipe'}
                    </span>
                    <div style="display:flex;gap:8px;align-items:center">
                        <span class="step-count">×${bld.count || 1} @ ${bld.clockSpeed || 100}%</span>
                        <button class="btn btn-ghost btn-sm btn-remove-bld" data-idx="${i}">✕</button>
                    </div>
                </div>
                ${recipe ? `<div class="step-flows">
                    <div class="step-flow">
                        <div class="step-flow-title">Inputs</div>
                        ${recipe.ingredients.map(ing => {
                            const rate = ing.amount * (60 / recipe.manufacturingDuration) * ((bld.clockSpeed || 100) / 100) * (bld.count || 1);
                            return `<div class="step-flow-item"><div class="item-cell">${itemIcon(ing.itemId, gameData, 16, 'item-icon-sm')}<span>${gameData.items[ing.itemId]?.name || ing.itemId}</span></div><span class="rate">${fmtRate(rate, ing.itemId, gameData)}</span></div>`;
                        }).join('')}
                    </div>
                    <div class="step-flow">
                        <div class="step-flow-title">Outputs</div>
                        ${recipe.products.map(prod => {
                            const rate = prod.amount * (60 / recipe.manufacturingDuration) * ((bld.clockSpeed || 100) / 100) * (bld.count || 1);
                            return `<div class="step-flow-item"><div class="item-cell">${itemIcon(prod.itemId, gameData, 16, 'item-icon-sm')}<span>${gameData.items[prod.itemId]?.name || prod.itemId}</span></div><span class="rate">${fmtRate(rate, prod.itemId, gameData)}</span></div>`;
                        }).join('')}
                    </div>
                </div>` : ''}
            </div>`;
        }

        tabContent = `
        <div class="planner-layout">
            <div class="planner-results">
                <div class="card">
                    <div class="card-title" style="margin-bottom:14px">Production Lines</div>
                    ${buildingsHTML || '<p style="color:var(--text-muted);padding:20px 0">No production lines added yet.</p>'}
                </div>
            </div>
            <div class="planner-config">
                <div class="card" style="position:sticky;top:32px">
                    <div style="font-size:14px;font-weight:600;margin-bottom:12px">Add Production Line</div>
                    <div class="input-group">
                        <label>Item to Produce</label>
                        <select id="add-item-select"><option value="">Select item...</option>${itemOptions}</select>
                    </div>
                    <div id="recipe-select-container" style="display:none">
                        <div class="input-group">
                            <label>Recipe</label>
                            <select id="add-recipe-select"></select>
                        </div>
                    </div>
                    <div id="production-config" style="display:none">
                        <div style="display:flex;gap:12px;align-items:flex-end;margin-bottom:12px">
                            <div class="input-group" style="flex:1;margin-bottom:0">
                                <label>Output Rate</label>
                                <input type="number" id="add-output-rate" value="10" min="0.1" step="0.1" />
                            </div>
                            <div class="input-group" style="flex:1;margin-bottom:0">
                                <label>Machines</label>
                                <input type="number" id="add-bld-count" value="1" min="1" readonly style="opacity:0.7" />
                            </div>
                            <div class="input-group" style="flex:1;margin-bottom:0">
                                <label>Clock %</label>
                                <input type="number" id="add-bld-clock" value="100" min="1" max="250" readonly style="opacity:0.7" />
                            </div>
                        </div>
                        <div id="production-preview" style="font-size:12px;color:var(--text-secondary);margin-bottom:12px"></div>
                        <button class="btn btn-primary btn-sm" id="add-bld-btn" style="width:100%">Add Production Line</button>
                    </div>
                </div>
            </div>
        </div>`;
        
        // Built in save toggle
        const { saveData } = getState();
        if (saveData) {
            tabContent = `
            <div style="background:var(--bg-input);border:1px solid var(--border-color);border-radius:var(--radius-md);padding:12px 16px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center">
                <div>
                    <div style="font-weight:600;font-size:14px;color:var(--text-primary)">Already built in save</div>
                    <div style="font-size:12px;color:var(--text-secondary)">This factory is built in your current save file. Turn this on so it doesn't double-count on your global dashboard.</div>
                </div>
                <label class="toggle-switch">
                    <input type="checkbox" id="factory-built-toggle" ${factory.countedInSave ? 'checked' : ''}>
                    <span class="slider"></span>
                </label>
            </div>
            ` + tabContent;
        }
    } 
    else if (activeTab === 'materials') {
        const itemSummary = {};
        for (const step of factoryResultCache.steps) {
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
            
            let sourcedToggle = '';
            let sourcedBadge = '';
            
            const isSourced = factory.sourcedInputs && factory.sourcedInputs.includes(itemId);
            if (isSourced) {
                sourcedBadge = `<span style="font-size:10px;padding:2px 6px;background:var(--accent-blue-dim);color:var(--accent-blue);border-radius:4px;margin-left:8px;white-space:nowrap">Globally Sourced</span>`;
            }
            sourcedToggle = `
            <div style="display:flex;justify-content:center">
                <label class="toggle-switch" style="transform:scale(0.8)">
                    <input type="checkbox" class="source-toggle" data-item="${itemId}" ${isSourced ? 'checked' : ''}>
                    <span class="slider"></span>
                </label>
            </div>`;
            
            rows += `<tr>
                <td><div class="item-cell">${itemIcon(itemId, gameData)}<span>${item?.name || itemId}</span>${sourcedBadge}</div></td>
                <td class="rate-cell rate-surplus">${summary.produced > 0 ? fmtRate(summary.produced, itemId, gameData) : '-'}</td>
                <td class="rate-cell rate-deficit">${summary.consumed > 0 ? fmtRate(summary.consumed, itemId, gameData) : '-'}</td>
                <td class="rate-cell ${netClass}">${fmtRate(net, itemId, gameData)}</td>
                <td>${sourcedToggle}</td>
            </tr>`;
        }

        tabContent = `<div class="card">
            <div class="card-title" style="margin-bottom:14px">Material I/O</div>
            <div class="table-container" style="max-height:60vh;overflow-y:auto">
                <table><thead><tr><th>Item</th><th>Produced</th><th>Consumed</th><th>Net</th><th style="text-align:center">Globally Sourced</th></tr></thead>
                <tbody>${rows || '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text-muted)">No materials used</td></tr>'}</tbody></table>
            </div>
        </div>`;
    }
    else if (activeTab === 'diagram') {
        tabContent = `<div class="card" style="padding:0;overflow:hidden">
            <canvas id="flowchart-canvas" style="width:100%;height:600px;display:block;cursor:grab"></canvas>
        </div>`;
    }
    else if (activeTab === 'grid') {
        // Calculate global balance excluding this factory (to see impact)
        const globalBalance = computeGlobalBalance(); // uses all factories
        const thisFactoryImpact = computeGlobalBalance([factory], false); // only this factory, no save data
        
        let rows = '';
        for (const [itemId, impact] of Object.entries(thisFactoryImpact)) {
            const global = globalBalance[itemId] || { produced: 0, consumed: 0 };
            const item = gameData.items[itemId];
            
            const prodPct = global.produced > 0 ? (impact.produced / global.produced) * 100 : (impact.produced > 0 ? 100 : 0);
            const consPct = global.consumed > 0 ? (impact.consumed / global.consumed) * 100 : (impact.consumed > 0 ? 100 : 0);
            
            if (impact.produced > 0 || impact.consumed > 0) {
                rows += `<tr>
                    <td><div class="item-cell">${itemIcon(itemId, gameData)}<span>${item?.name || itemId}</span></div></td>
                    <td class="rate-cell rate-surplus">${impact.produced > 0 ? `${fmtRate(impact.produced, itemId, gameData)} <span style="font-size:10px;color:var(--text-muted)">(${fmt(prodPct, 1)}% of global)</span>` : '-'}</td>
                    <td class="rate-cell rate-deficit">${impact.consumed > 0 ? `${fmtRate(impact.consumed, itemId, gameData)} <span style="font-size:10px;color:var(--text-muted)">(${fmt(consPct, 1)}% of global)</span>` : '-'}</td>
                    <td>${renderProgressBar(global.produced, global.consumed, itemId)}</td>
                </tr>`;
            }
        }
        
        tabContent = `<div class="card">
            <div class="card-title" style="margin-bottom:14px">Impact on Global Grid</div>
            <div class="table-container" style="max-height:60vh;overflow-y:auto">
                <table><thead><tr><th style="min-width:200px">Item</th><th>Produced Here</th><th>Consumed Here</th><th>Usage (Global)</th></tr></thead>
                <tbody>${rows || '<tr><td colspan="4" style="text-align:center;padding:20px;color:var(--text-muted)">No impact</td></tr>'}</tbody></table>
            </div>
        </div>`;
    }

    return `
    <div class="fade-in">
        <div class="factory-detail-header">
            <div>
                <button class="btn btn-ghost btn-sm" id="btn-back-factories" style="margin-bottom:8px;padding-left:0">← Back to Factories</button>
                <h1>${factory.name}</h1>
                <p style="color:var(--text-secondary);font-size:14px;margin-top:4px">${factory.description || 'No description'}</p>
            </div>
            <div style="display:flex;gap:16px;text-align:right">
                <div><div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;font-weight:600">Buildings</div><div style="font-size:18px;font-weight:700;font-family:var(--font-mono)">${factoryResultCache.totalMachines}</div></div>
                <div><div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;font-weight:600">Power</div><div style="font-size:18px;font-weight:700;font-family:var(--font-mono)">${fmt(factoryResultCache.totalPower)} MW</div></div>
            </div>
        </div>
        
        <div class="factory-tabs">
            <button class="factory-tab ${activeTab === 'overview' ? 'active' : ''}" data-tab="overview">📋 Overview</button>
            <button class="factory-tab ${activeTab === 'materials' ? 'active' : ''}" data-tab="materials">📦 Materials</button>
            <button class="factory-tab ${activeTab === 'diagram' ? 'active' : ''}" data-tab="diagram">🔗 Diagram</button>
            <button class="factory-tab ${activeTab === 'grid' ? 'active' : ''}" data-tab="grid">🌍 Grid Impact</button>
        </div>
        
        ${tabContent}
    </div>`;
}


export function initFactories() {
    if (activeFactoryId) {
        initFactoryDetail();
        return;
    }

    const addBtn = document.getElementById('add-factory-btn') || document.getElementById('add-factory-empty');
    if (addBtn) addBtn.addEventListener('click', showAddFactoryModal);

    document.querySelectorAll('.btn-delete-factory').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (!confirm('Delete this factory?')) return;
            try {
                await api.deleteFactory(btn.dataset.id);
                const factories = await api.getFactories();
                setState('factories', factories);
                showToast('Factory deleted', 'success');
                rerender();
            } catch (err) { showToast(err.message, 'error'); }
        });
    });

    document.querySelectorAll('.factory-card').forEach(card => {
        card.addEventListener('click', (e) => {
            if (e.target.closest('.btn-delete-factory')) return;
            activeFactoryId = card.dataset.factoryId;
            activeTab = 'overview';
            factoryResultCache = null;
            rerender();
        });
    });
}

function initFactoryDetail() {
    document.getElementById('btn-back-factories')?.addEventListener('click', () => {
        activeFactoryId = null;
        factoryResultCache = null;
        rerender();
    });

    document.querySelectorAll('.factory-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            activeTab = tab.dataset.tab;
            rerender();
            if (activeTab === 'diagram' && factoryResultCache) {
                const { gameData } = getState();
                setTimeout(() => initFlowchart(factoryResultCache, gameData), 50);
            }
        });
    });
    
    if (activeTab === 'materials') {
        document.querySelectorAll('.source-toggle').forEach(toggle => {
            toggle.addEventListener('change', async (e) => {
                const { factories } = getState();
                const factory = factories.find(f => f.id === activeFactoryId);
                if (!factory) return;
                
                if (!factory.sourcedInputs) factory.sourcedInputs = [];
                const itemId = e.target.dataset.item;
                if (e.target.checked) {
                    if (!factory.sourcedInputs.includes(itemId)) factory.sourcedInputs.push(itemId);
                } else {
                    factory.sourcedInputs = factory.sourcedInputs.filter(id => id !== itemId);
                }
                
                try {
                    await api.updateFactory(factory.id, factory);
                    const updatedFactories = await api.getFactories();
                    setState('factories', updatedFactories);
                } catch (err) { showToast(err.message, 'error'); }
            });
        });
    }

    if (activeTab === 'diagram' && factoryResultCache) {
        const { gameData } = getState();
        setTimeout(() => initFlowchart(factoryResultCache, gameData), 50);
    }

    if (activeTab === 'overview') {
        const { gameData, unlockedAlternates } = getState();
        
        document.getElementById('factory-built-toggle')?.addEventListener('change', async (e) => {
            const { factories } = getState();
            const factory = factories.find(f => f.id === activeFactoryId);
            if (!factory) return;
            factory.countedInSave = e.target.checked;
            try {
                await api.updateFactory(factory.id, factory);
                const updatedFactories = await api.getFactories();
                setState('factories', updatedFactories);
                showToast('Factory updated', 'success');
            } catch (err) { showToast(err.message, 'error'); }
        });
        
        document.getElementById('add-item-select')?.addEventListener('change', (e) => {
            const itemId = e.target.value;
            const recipeContainer = document.getElementById('recipe-select-container');
            const configContainer = document.getElementById('production-config');
            
            if (!itemId) {
                recipeContainer.style.display = 'none';
                configContainer.style.display = 'none';
                return;
            }

            const recipeIds = gameData.itemRecipeMap[itemId] || [];
            const recipeSelect = document.getElementById('add-recipe-select');
            recipeSelect.innerHTML = recipeIds.map(rId => {
                const r = gameData.recipes[rId];
                const unlocked = !r.isAlternate || (unlockedAlternates || []).includes(rId);
                const label = r.name + (r.isAlternate ? (unlocked ? ' ★' : ' 🔒') : '');
                return `<option value="${rId}">${label}</option>`;
            }).join('');

            recipeContainer.style.display = '';
            configContainer.style.display = '';
            updateProductionPreview(itemId, gameData);
        });

        document.getElementById('add-recipe-select')?.addEventListener('change', () => {
            updateProductionPreview(document.getElementById('add-item-select').value, gameData);
        });

        document.getElementById('add-output-rate')?.addEventListener('input', () => {
            updateProductionPreview(document.getElementById('add-item-select').value, gameData);
        });

        document.getElementById('add-bld-btn')?.addEventListener('click', async () => {
            const { factories } = getState();
            const factory = factories.find(f => f.id === activeFactoryId);
            if (!factory) return;
            
            const recipeId = document.getElementById('add-recipe-select').value;
            if (!recipeId) { showToast('Select a recipe', 'error'); return; }
            const recipe = gameData.recipes[recipeId];
            const buildingId = recipe.producedIn[0] || null;
            const count = parseInt(document.getElementById('add-bld-count').value) || 1;
            const clockSpeed = parseFloat(document.getElementById('add-bld-clock').value) || 100;

            factory.buildings = factory.buildings || [];
            factory.buildings.push({ recipeId, buildingId, count, clockSpeed });
            try {
                await api.updateFactory(factory.id, factory);
                const updatedFactories = await api.getFactories();
                setState('factories', updatedFactories);
                factoryResultCache = null; // Invalidate cache
                showToast('Production line added!', 'success');
                rerender();
            } catch (err) { showToast(err.message, 'error'); }
        });

        document.querySelectorAll('.btn-remove-bld').forEach(btn => {
            btn.addEventListener('click', async () => {
                const { factories } = getState();
                const factory = factories.find(f => f.id === activeFactoryId);
                if (!factory) return;
                
                const idx = parseInt(btn.dataset.idx);
                factory.buildings.splice(idx, 1);
                try {
                    await api.updateFactory(factory.id, factory);
                    const updatedFactories = await api.getFactories();
                    setState('factories', updatedFactories);
                    factoryResultCache = null; // Invalidate cache
                    rerender();
                } catch (err) { showToast(err.message, 'error'); }
            });
        });
    }
}

function updateProductionPreview(targetItemId, gameData) {
    const recipeId = document.getElementById('add-recipe-select').value;
    const outputRate = parseFloat(document.getElementById('add-output-rate').value) || 0;
    const recipe = gameData.recipes[recipeId];
    if (!recipe || !outputRate) return;

    const targetProduct = recipe.products.find(p => p.itemId === targetItemId);
    if (!targetProduct || !recipe.manufacturingDuration) return;

    const cyclesPerMinute = 60 / recipe.manufacturingDuration;
    const outputPerMachine = targetProduct.amount * cyclesPerMinute;
    const machinesNeeded = outputRate / outputPerMachine;
    const wholeMachines = Math.ceil(machinesNeeded);
    const clockSpeed = Math.round((machinesNeeded / wholeMachines) * 10000) / 100;

    document.getElementById('add-bld-count').value = wholeMachines;
    document.getElementById('add-bld-clock').value = clockSpeed;

    const building = recipe.producedIn[0] ? gameData.buildings[recipe.producedIn[0]] : null;
    const preview = `<strong>${building?.name || 'Machine'}</strong> ×${wholeMachines} @ ${clockSpeed}% → ${fmtRate(outputRate, targetItemId, gameData)}`;
    document.getElementById('production-preview').innerHTML = preview;
}

export function showAddFactoryModal(initialName = '', initialDescription = '', prefilledBuildings = null) {
    const { saveData } = getState();
    const hasSave = !!saveData;

    showModal(`
        <div class="modal-title">${prefilledBuildings ? 'Create Factory from Plan' : 'New Factory'}</div>
        <div class="input-group">
            <label>Factory Name</label>
            <input type="text" id="factory-name" placeholder="e.g. Battery Factory" value="${initialName}" />
        </div>
        <div class="input-group">
            <label>Description (optional)</label>
            <textarea id="factory-desc" rows="2" placeholder="What does this factory produce?">${initialDescription}</textarea>
        </div>
        ${hasSave ? `
        <div style="padding:12px;background:var(--bg-input);border-radius:var(--radius-sm);border:1px solid var(--border-color);margin-bottom:16px">
            <label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;font-size:13px;color:var(--text-secondary)">
                <input type="checkbox" id="factory-counted-in-save" style="width:auto;margin-top:2px" />
                <span><strong style="color:var(--text-primary);display:block;margin-bottom:4px">Already built in save</strong>This factory's production is already counted in the save file data. Checking this prevents double-counting its input/output on the global grid impact.</span>
            </label>
        </div>` : `
        <div style="padding:12px;background:var(--bg-input);border-radius:var(--radius-sm);border:1px solid var(--border-color);margin-bottom:16px">
            <div style="font-size:13px;color:var(--text-secondary)">
                <strong style="color:var(--text-primary);display:block;margin-bottom:4px">Grid Impact</strong>
                Because no save file is loaded, this factory will automatically contribute to your theoretical global grid impact.
            </div>
        </div>
        `}
        <div class="modal-actions">
            <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
            <button class="btn btn-primary" id="modal-create">Create Factory</button>
        </div>
    `);
    document.getElementById('modal-cancel').addEventListener('click', hideModal);
    document.getElementById('modal-create').addEventListener('click', async () => {
        const name = document.getElementById('factory-name').value.trim();
        if (!name) { showToast('Please enter a name', 'error'); return; }
        const countedInSave = document.getElementById('factory-counted-in-save')?.checked || false;
        
        const payload = { 
            name, 
            description: document.getElementById('factory-desc').value.trim(), 
            countedInSave 
        };
        
        if (prefilledBuildings) {
            payload.buildings = prefilledBuildings;
        }
        
        try {
            await api.createFactory(payload);
            const factories = await api.getFactories();
            setState('factories', factories);
            hideModal();
            showToast('Factory created!', 'success');
            
            // If we're not currently on the factories page, this rerender might be redundant,
            // but it's safe to call. The caller might want to navigate to factories.
            if (document.getElementById('add-factory-btn')) {
                rerender();
            }
        } catch (err) { showToast(err.message, 'error'); }
    });
}

function rerender() {
    document.getElementById('page-content').innerHTML = renderFactories();
    initFactories();
}
