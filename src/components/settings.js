import { getState, setState, showToast, itemIcon } from '../modules/state.js';
import { api } from '../modules/api.js';

export function renderSettings() {
    const { gameData, unlockedAlternates } = getState();
    const allAlts = gameData ? Object.values(gameData.recipes).filter(r => r.isAlternate && r.isMachineRecipe).sort((a, b) => a.name.localeCompare(b.name)) : [];
    const unlocked = unlockedAlternates || [];
    const unlockedCount = unlocked.length;

    let altListHTML = '';
    if (allAlts.length > 0) {
        altListHTML = allAlts.map(recipe => {
            const isUnlocked = unlocked.includes(recipe.id);
            const outputItemId = recipe.products[0]?.itemId;
            return `<label class="alt-recipe-item ${isUnlocked ? 'unlocked' : 'locked'}" data-recipe-id="${recipe.id}">
                <input type="checkbox" class="alt-checkbox" data-recipe-id="${recipe.id}" ${isUnlocked ? 'checked' : ''} />
                <div class="alt-recipe-info">
                    ${outputItemId ? itemIcon(outputItemId, gameData, 24) : ''}
                    <span>${recipe.name}</span>
                </div>
                <span class="badge ${isUnlocked ? 'badge-surplus' : 'badge-info'}" style="font-size:10px">${isUnlocked ? 'Unlocked' : 'Locked'}</span>
            </label>`;
        }).join('');
    }

    return `
    <div class="fade-in">
        <div class="page-header">
            <div>
                <h1>Settings</h1>
                <p>Configure your Satisfactory Manager</p>
            </div>
        </div>
        <div class="card" style="max-width:600px">
            <div class="card-title" style="margin-bottom:20px">General</div>
            <div class="input-group">
                <label>Theme</label>
                <select id="setting-theme">
                    <option value="dark" selected>Dark (Default)</option>
                    <option value="light" disabled>Light (Coming Soon)</option>
                </select>
            </div>
        </div>
        <div class="card" style="max-width:600px;margin-top:16px">
            <div class="card-header">
                <div>
                    <div class="card-title">Alternate Recipes</div>
                    <div class="card-subtitle">${unlockedCount} of ${allAlts.length} unlocked • Upload a save file to auto-detect, or toggle manually</div>
                </div>
                <div style="display:flex;gap:8px">
                    <button class="btn btn-secondary btn-sm" id="alt-select-all">Select All</button>
                    <button class="btn btn-secondary btn-sm" id="alt-deselect-all">Deselect All</button>
                </div>
            </div>
            <div class="search-box" style="margin-bottom:12px">
                <input type="search" id="alt-search" placeholder="Search alternate recipes..." />
            </div>
            <div id="alt-recipe-list" style="max-height:50vh;overflow-y:auto;display:flex;flex-direction:column;gap:4px">
                ${altListHTML || '<p style="color:var(--text-muted)">No game data loaded</p>'}
            </div>
        </div>
        <div class="card" style="max-width:600px;margin-top:16px">
            <div class="card-title" style="margin-bottom:20px">Data Management</div>
            <p style="font-size:13px;color:var(--text-secondary);margin-bottom:16px">
                Game data version: <strong>Stable 1.0</strong> • 
                Data source: satisfactory-calculator.com
            </p>
            <div style="display:flex;gap:12px">
                <button class="btn btn-secondary" id="export-data">Export Factories</button>
                <button class="btn btn-danger" id="clear-data">Clear All Data</button>
            </div>
        </div>
        <div class="card" style="max-width:600px;margin-top:16px">
            <div class="card-title" style="margin-bottom:12px">About</div>
            <p style="font-size:13px;color:var(--text-secondary);line-height:1.7">
                Satisfactory Manager helps you track and plan your factory production.<br>
                Built with ❤️ using the <a href="https://github.com/etothepii4/satisfactory-file-parser" target="_blank" style="color:var(--accent-orange)">satisfactory-file-parser</a> library 
                and game data from <a href="https://satisfactory-calculator.com" target="_blank" style="color:var(--accent-orange)">satisfactory-calculator.com</a>.
            </p>
        </div>
    </div>`;
}

export function initSettings() {
    // Alternate recipe checkboxes
    document.querySelectorAll('.alt-checkbox').forEach(cb => {
        cb.addEventListener('change', async () => {
            const { unlockedAlternates } = getState();
            const current = [...(unlockedAlternates || [])];
            const recipeId = cb.dataset.recipeId;
            
            if (cb.checked) {
                if (!current.includes(recipeId)) current.push(recipeId);
            } else {
                const idx = current.indexOf(recipeId);
                if (idx >= 0) current.splice(idx, 1);
            }

            setState('unlockedAlternates', current);
            try {
                await api.updateUnlockedAlternates(current);
            } catch (err) {
                showToast('Failed to save: ' + err.message, 'error');
            }

            // Update the label styling
            const label = cb.closest('.alt-recipe-item');
            if (label) {
                label.classList.toggle('unlocked', cb.checked);
                label.classList.toggle('locked', !cb.checked);
                const badge = label.querySelector('.badge');
                if (badge) {
                    badge.textContent = cb.checked ? 'Unlocked' : 'Locked';
                    badge.className = `badge ${cb.checked ? 'badge-surplus' : 'badge-info'}`;
                    badge.style.fontSize = '10px';
                }
            }
        });
    });

    // Select/Deselect all
    document.getElementById('alt-select-all')?.addEventListener('click', async () => {
        const { gameData } = getState();
        const allAltIds = Object.values(gameData.recipes).filter(r => r.isAlternate && r.isMachineRecipe).map(r => r.id);
        setState('unlockedAlternates', allAltIds);
        try {
            await api.updateUnlockedAlternates(allAltIds);
            showToast(`Unlocked all ${allAltIds.length} alternate recipes`, 'success');
            document.getElementById('page-content').innerHTML = renderSettings();
            initSettings();
        } catch (err) { showToast(err.message, 'error'); }
    });

    document.getElementById('alt-deselect-all')?.addEventListener('click', async () => {
        setState('unlockedAlternates', []);
        try {
            await api.updateUnlockedAlternates([]);
            showToast('All alternate recipes locked', 'success');
            document.getElementById('page-content').innerHTML = renderSettings();
            initSettings();
        } catch (err) { showToast(err.message, 'error'); }
    });

    // Search
    document.getElementById('alt-search')?.addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase();
        document.querySelectorAll('.alt-recipe-item').forEach(item => {
            const name = item.querySelector('.alt-recipe-info span')?.textContent?.toLowerCase() || '';
            item.style.display = name.includes(q) ? '' : 'none';
        });
    });

    // Export
    document.getElementById('export-data')?.addEventListener('click', async () => {
        try {
            const factories = await api.getFactories();
            const blob = new Blob([JSON.stringify(factories, null, 2)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'satisfactory-manager-export.json';
            a.click();
            showToast('Exported factory data', 'success');
        } catch (err) { showToast(err.message, 'error'); }
    });

    // Clear
    document.getElementById('clear-data')?.addEventListener('click', () => {
        if (confirm('This will delete all your factory data. Are you sure?')) {
            fetch('/api/factories').then(r => r.json()).then(factories => {
                Promise.all(factories.map(f => fetch(`/api/factories/${f.id}`, { method: 'DELETE' })))
                    .then(() => { location.reload(); });
            });
        }
    });
}
