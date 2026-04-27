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
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
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
