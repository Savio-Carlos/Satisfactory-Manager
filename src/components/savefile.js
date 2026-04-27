import { parseSaveFileLocal } from '../modules/saveParser.js';
import { getState, setState, showToast, fmt, fmtRate, itemIcon } from '../modules/state.js';
import { api } from '../modules/api.js';

export function renderSaveFile() {
    const { saveData, gameData, unlockedAlternates } = getState();

    const altCount = (unlockedAlternates || []).length;
    const totalAlts = gameData ? Object.values(gameData.recipes).filter(r => r.isAlternate && r.isMachineRecipe).length : 0;

    const saveInfoHTML = saveData ? `
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-label">Production Buildings</div>
                <div class="stat-value">${saveData.totalBuildings}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Items Tracked</div>
                <div class="stat-value">${saveData.globalBalance?.length || 0}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Alternate Recipes</div>
                <div class="stat-value">${altCount}/${totalAlts}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Session</div>
                <div class="stat-value" style="font-size:16px">${saveData.saveInfo?.header?.sessionName || 'Unknown'}</div>
            </div>
        </div>
        <div class="card">
            <div class="card-header">
                <div>
                    <div class="card-title">Detected Production (from Save)</div>
                    <div class="card-subtitle">Global resource balance detected from your save file</div>
                </div>
            </div>
            <div class="table-container" style="max-height:50vh;overflow-y:auto">
                <table>
                    <thead><tr><th>Item</th><th>Production</th><th>Consumption</th><th>Net</th><th>Status</th></tr></thead>
                    <tbody>
                        ${(saveData.globalBalance || []).map(item => {
                            const netClass = item.net > 0.01 ? 'rate-surplus' : item.net < -0.01 ? 'rate-deficit' : 'rate-balanced';
                            const badgeClass = item.net > 0.01 ? 'badge-surplus' : item.net < -0.01 ? 'badge-deficit' : 'badge-balanced';
                            const badgeText = item.net > 0.01 ? 'Surplus' : item.net < -0.01 ? 'Deficit' : 'Balanced';
                            return `<tr>
                                <td><div class="item-cell">
                                    ${itemIcon(item.itemId, gameData)}
                                    <span>${item.itemName}</span>
                                </div></td>
                                <td class="rate-cell rate-surplus">${item.produced > 0 ? fmtRate(item.produced, item.itemId, gameData) : '-'}</td>
                                <td class="rate-cell rate-deficit">${item.consumed > 0 ? fmtRate(item.consumed, item.itemId, gameData) : '-'}</td>
                                <td class="rate-cell ${netClass}">${item.net > 0 ? '+' : ''}${fmtRate(item.net, item.itemId, gameData)}</td>
                                <td><span class="badge ${badgeClass}">${badgeText}</span></td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        </div>
        
        <div class="card" style="margin-top:24px">
            <div class="card-header" style="cursor:pointer" id="toggle-raw-data">
                <div>
                    <div class="card-title">Raw Save Data Explorer</div>
                    <div class="card-subtitle">Detailed parse information (click to expand)</div>
                </div>
                <div style="font-size:24px;color:var(--text-muted)">▾</div>
            </div>
            <div id="raw-data-content" style="display:none;padding-top:16px;border-top:1px solid var(--border-color)">
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px">
                    <div>
                        <div style="font-size:14px;font-weight:600;margin-bottom:12px;color:var(--text-secondary)">Building Counts</div>
                        <div class="table-container" style="max-height:400px;overflow-y:auto">
                            <table>
                                <thead><tr><th>Building Type</th><th>Count</th></tr></thead>
                                <tbody>
                                    ${getBuildingCounts(saveData.buildings, gameData)}
                                </tbody>
                            </table>
                        </div>
                    </div>
                    <div>
                        <div style="font-size:14px;font-weight:600;margin-bottom:12px;color:var(--text-secondary)">Factory Map (Production Buildings)</div>
                        <div style="background:var(--bg-input);border:1px solid var(--border-color);border-radius:var(--radius-md);height:400px;position:relative;overflow:hidden">
                            ${renderMap(saveData.buildings)}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    ` : '';

    return `
    <div class="fade-in">
        <div class="page-header">
            <div>
                <h1>Save File</h1>
                <p>Upload your .sav file to auto-detect production buildings and unlocked recipes</p>
            </div>
        </div>

        <div class="card" style="margin-bottom:24px">
            <div class="upload-zone" id="upload-zone">
                <div class="upload-zone-icon">💾</div>
                <h3>Drop your .sav file here</h3>
                <p>or click to browse • Located at %LOCALAPPDATA%\\FactoryGame\\Saved\\SaveGames\\</p>
                <input type="file" id="save-file-input" accept=".sav" style="display:none" />
            </div>
            <div id="upload-progress" style="display:none;padding:20px;text-align:center">
                <div class="loading-spinner"></div>
                <p style="margin-top:12px;color:var(--text-secondary)">Parsing save file... This may take a minute for large saves.</p>
            </div>
        </div>

        ${saveInfoHTML}
    </div>`;
}

function formatPlayTime(seconds) {
    if (!seconds) return 'Unknown';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
}

function getBuildingCounts(buildings, gameData) {
    if (!buildings || buildings.length === 0) return '<tr><td colspan="2" class="text-muted">No buildings found</td></tr>';
    const counts = {};
    for (const bld of buildings) {
        counts[bld.buildingId] = (counts[bld.buildingId] || 0) + 1;
    }
    return Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .map(([id, count]) => {
            const bld = gameData.buildings[id];
            return `<tr>
                <td><div class="item-cell">${itemIcon(id, gameData, 16, 'item-icon-sm')}<span>${bld?.name || id}</span></div></td>
                <td style="font-family:var(--font-mono);font-weight:600">${count}</td>
            </tr>`;
        }).join('');
}

function renderMap(buildings) {
    if (!buildings || buildings.length === 0) return '<div class="empty-state">No location data</div>';
    
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const validBlds = buildings.filter(b => b.position);
    if (validBlds.length === 0) return '<div class="empty-state">No location data</div>';
    
    for (const b of validBlds) {
        minX = Math.min(minX, b.position.x);
        maxX = Math.max(maxX, b.position.x);
        minY = Math.min(minY, b.position.y);
        maxY = Math.max(maxY, b.position.y);
    }
    
    const rangeX = Math.max(maxX - minX, 1000);
    const rangeY = Math.max(maxY - minY, 1000);
    
    const dots = validBlds.map(b => {
        const px = ((b.position.x - minX) / rangeX) * 90 + 5;
        const py = ((b.position.y - minY) / rangeY) * 90 + 5;
        return `<div style="position:absolute;left:${px}%;top:${py}%;width:4px;height:4px;background:var(--accent-orange);border-radius:50%;opacity:0.6" title="${b.buildingName}"></div>`;
    }).join('');
    
    return `<div style="width:100%;height:100%;position:relative;background:#0c1220">${dots}</div>`;
}

export function initSaveFile() {
    const zone = document.getElementById('upload-zone');
    const input = document.getElementById('save-file-input');
    if (!zone || !input) return;

    zone.addEventListener('click', () => input.click());
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.classList.remove('dragover');
        if (e.dataTransfer.files.length) handleSaveUpload(e.dataTransfer.files[0]);
    });
    input.addEventListener('change', () => { if (input.files.length) handleSaveUpload(input.files[0]); });

    const toggleBtn = document.getElementById('toggle-raw-data');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            const content = document.getElementById('raw-data-content');
            const arrow = toggleBtn.querySelector('div:last-child');
            if (content.style.display === 'none') {
                content.style.display = 'block';
                arrow.textContent = '▴';
            } else {
                content.style.display = 'none';
                arrow.textContent = '▾';
            }
        });
    }
}


async function handleSaveUpload(file) {
    if (!file.name.endsWith('.sav')) {
        showToast('Please upload a .sav file', 'error');
        return;
    }

    document.getElementById('upload-zone').style.display = 'none';
    document.getElementById('upload-progress').style.display = 'block';

    // Allow UI to update before blocking parser
    setTimeout(async () => {
        try {
            const { gameData } = getState();
            // Parse locally! Bypass DO 30s timeout and memory limits
            const result = await parseSaveFileLocal(file, gameData);
            
            setState('saveData', result);

            // Update unlocked alternates
            if (result.unlockedAlternates) {
                setState('unlockedAlternates', result.unlockedAlternates);
                // Also update on backend to persist if we ever switch back
                try { api.updateUnlockedAlternates(result.unlockedAlternates); } catch (e) {}
            }

            showToast(`Parsed ${result.totalBuildings} buildings, ${result.unlockedAlternates?.length || 0} alternate recipes!`, 'success');
            document.getElementById('page-content').innerHTML = renderSaveFile();
            initSaveFile();
        } catch (err) {
            showToast('Failed to parse: ' + err.message, 'error');
            document.getElementById('upload-zone').style.display = '';
            document.getElementById('upload-progress').style.display = 'none';
        }
    }, 100);
}
