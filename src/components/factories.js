import { getState, setState, showToast, showModal, hideModal, fmt, fmtRate, itemIcon } from '../modules/state.js';
import { api } from '../modules/api.js';

export function renderFactories() {
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
            const mainOutputs = getFactoryOutputs(f, gameData);
            const saveTag = f.countedInSave ? '<span class="badge badge-info" style="margin-left:8px;font-size:10px">From Save</span>' : '';
            cards += `<div class="factory-card" data-factory-id="${f.id}">
                <div class="factory-card-header">
                    <div class="factory-card-name">${f.name}${saveTag}</div>
                    <button class="btn btn-ghost btn-sm btn-delete-factory" data-id="${f.id}" title="Delete">🗑️</button>
                </div>
                ${f.description ? `<div class="factory-card-desc">${f.description}</div>` : ''}
                <div class="factory-card-stats">
                    <div class="factory-card-stat"><strong>${buildingCount}</strong> buildings</div>
                    <div class="factory-card-stat">${mainOutputs}</div>
                </div>
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

function getFactoryOutputs(factory, gameData) {
    if (!factory.buildings?.length || !gameData) return '<span style="color:var(--text-muted)">No buildings</span>';
    const outputs = {};
    for (const bld of factory.buildings) {
        const recipe = gameData.recipes[bld.recipeId];
        if (!recipe) continue;
        for (const p of recipe.products) {
            const name = gameData.items[p.itemId]?.name || p.itemId;
            outputs[name] = true;
        }
    }
    const names = Object.keys(outputs).slice(0, 3);
    return names.map(n => `<span class="badge badge-info">${n}</span>`).join(' ') || '<span style="color:var(--text-muted)">Idle</span>';
}

export function initFactories() {
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
                document.getElementById('page-content').innerHTML = renderFactories();
                initFactories();
            } catch (err) { showToast(err.message, 'error'); }
        });
    });

    document.querySelectorAll('.factory-card').forEach(card => {
        card.addEventListener('click', (e) => {
            if (e.target.closest('.btn-delete-factory')) return;
            showFactoryDetail(card.dataset.factoryId);
        });
    });
}

function showAddFactoryModal() {
    const { saveData } = getState();
    const hasSave = !!saveData;

    showModal(`
        <div class="modal-title">New Factory</div>
        <div class="input-group">
            <label>Factory Name</label>
            <input type="text" id="factory-name" placeholder="e.g. Battery Factory" />
        </div>
        <div class="input-group">
            <label>Description (optional)</label>
            <textarea id="factory-desc" rows="2" placeholder="What does this factory produce?"></textarea>
        </div>
        ${hasSave ? `
        <div style="padding:12px;background:var(--bg-input);border-radius:var(--radius-sm);border:1px solid var(--border-color);margin-bottom:16px">
            <label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-size:13px;color:var(--text-secondary)">
                <input type="checkbox" id="factory-counted-in-save" style="width:auto" />
                <span><strong style="color:var(--text-primary)">Already built in save</strong> — This factory's production is already counted in the save file data. Checking this prevents double-counting on the dashboard.</span>
            </label>
        </div>` : ''}
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
        try {
            await api.createFactory({ name, description: document.getElementById('factory-desc').value.trim(), countedInSave });
            const factories = await api.getFactories();
            setState('factories', factories);
            hideModal();
            showToast('Factory created!', 'success');
            document.getElementById('page-content').innerHTML = renderFactories();
            initFactories();
        } catch (err) { showToast(err.message, 'error'); }
    });
}

function showFactoryDetail(factoryId) {
    const { factories, gameData, unlockedAlternates } = getState();
    const factory = factories.find(f => f.id === factoryId);
    if (!factory) return;

    // Build searchable item list (items that can be produced by machine recipes)
    const producibleItems = Object.entries(gameData.itemRecipeMap)
        .map(([itemId]) => ({ id: itemId, name: gameData.items[itemId]?.name || itemId }))
        .sort((a, b) => a.name.localeCompare(b.name));

    const itemOptions = producibleItems
        .map(i => `<option value="${i.id}">${i.name}</option>`)
        .join('');

    let buildingsHTML = '';
    for (const [i, bld] of (factory.buildings || []).entries()) {
        const recipe = gameData.recipes[bld.recipeId];
        const building = bld.buildingId ? gameData.buildings[bld.buildingId] : null;
        buildingsHTML += `<div class="production-step">
            <div class="step-header">
                <span class="step-machine">${building?.name || 'Unknown'} — ${recipe?.name || 'No recipe'}</span>
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
                        return `<div class="step-flow-item"><span>${gameData.items[ing.itemId]?.name || ing.itemId}</span><span class="rate">${fmtRate(rate, ing.itemId, gameData)}</span></div>`;
                    }).join('')}
                </div>
                <div class="step-flow">
                    <div class="step-flow-title">Outputs</div>
                    ${recipe.products.map(prod => {
                        const rate = prod.amount * (60 / recipe.manufacturingDuration) * ((bld.clockSpeed || 100) / 100) * (bld.count || 1);
                        return `<div class="step-flow-item"><span>${gameData.items[prod.itemId]?.name || prod.itemId}</span><span class="rate">${fmtRate(rate, prod.itemId, gameData)}</span></div>`;
                    }).join('')}
                </div>
            </div>` : ''}
        </div>`;
    }

    showModal(`
        <div class="modal-title" style="display:flex;justify-content:space-between;align-items:center">
            <span>${factory.name}</span>
            <button class="btn btn-ghost btn-sm" id="close-detail">✕</button>
        </div>
        <div style="margin-bottom:20px">
            <div id="factory-buildings">${buildingsHTML || '<p style="color:var(--text-muted);padding:20px 0">No production lines added yet</p>'}</div>
        </div>
        <div class="card" style="padding:16px">
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
    `);

    // Wire up cascading selects
    document.getElementById('add-item-select').addEventListener('change', (e) => {
        const itemId = e.target.value;
        const recipeContainer = document.getElementById('recipe-select-container');
        const configContainer = document.getElementById('production-config');
        
        if (!itemId) {
            recipeContainer.style.display = 'none';
            configContainer.style.display = 'none';
            return;
        }

        // Get recipes for this item
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
        const itemId = document.getElementById('add-item-select').value;
        updateProductionPreview(itemId, gameData);
    });

    document.getElementById('add-output-rate')?.addEventListener('input', () => {
        const itemId = document.getElementById('add-item-select').value;
        updateProductionPreview(itemId, gameData);
    });

    document.getElementById('close-detail').addEventListener('click', () => {
        hideModal();
        document.getElementById('page-content').innerHTML = renderFactories();
        initFactories();
    });

    document.getElementById('add-bld-btn')?.addEventListener('click', async () => {
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
            const factories = await api.getFactories();
            setState('factories', factories);
            showToast('Production line added!', 'success');
            showFactoryDetail(factoryId);
        } catch (err) { showToast(err.message, 'error'); }
    });

    document.querySelectorAll('.btn-remove-bld').forEach(btn => {
        btn.addEventListener('click', async () => {
            const idx = parseInt(btn.dataset.idx);
            factory.buildings.splice(idx, 1);
            try {
                await api.updateFactory(factory.id, factory);
                const factories = await api.getFactories();
                setState('factories', factories);
                showFactoryDetail(factoryId);
            } catch (err) { showToast(err.message, 'error'); }
        });
    });
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
