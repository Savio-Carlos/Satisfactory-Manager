import { getState, fmt, fmtRate, itemIcon, renderProgressBar, renderLimitBar, computeGlobalBalance, RAW_LIMITS, isFluid } from '../modules/state.js';

export function renderDashboard() {
    const { gameData, factories, saveData } = getState();

    // Compute global balance
    const balance = computeGlobalBalance();

    const balanceList = Object.entries(balance)
        .map(([itemId, b]) => {
            const item = gameData?.items[itemId];
            return {
                itemId,
                name: item?.name || itemId.replace(/^Desc_|_C$/g, '').replace(/_/g, ' '),
                image: item?.image || null,
                produced: b.produced,
                consumed: b.consumed,
                net: b.produced - b.consumed
            };
        })
        .sort((a, b) => a.name.localeCompare(b.name));

    // World Resources: usage vs map-wide extraction limits.
    // RAW_LIMITS is in m³/min for fluids; balance.consumed is in mL/min (raw recipe units).
    const limitRows = Object.entries(RAW_LIMITS)
        .map(([itemId, limit]) => {
            const item = gameData?.items[itemId];
            const rawUsed = balance[itemId]?.consumed || 0;
            // Fluids: convert mL/min → m³/min to match RAW_LIMITS units.
            const used = isFluid(itemId, gameData) ? rawUsed / 1000 : rawUsed;
            const pct = (limit === Infinity || !isFinite(limit)) ? -1 : (limit > 0 ? (used / limit) * 100 : 0);
            return { itemId, name: item?.name || itemId, used, limit, pct };
        })
        .sort((a, b) => b.pct - a.pct);

    let limitRowsHtml = '';
    for (const r of limitRows) {
        const isInfinite = r.limit === Infinity || !isFinite(r.limit);
        const fluid = isFluid(r.itemId, gameData);
        const limitText = isInfinite ? '∞' : `${fmt(r.limit)} ${fluid ? 'm³' : 'items'}/min`;
        const usedText = `${fmt(r.used)} ${fluid ? 'm³' : 'items'}/min`;
        const pctText = isInfinite ? '∞' : `${r.pct < 0.05 ? '0' : r.pct.toFixed(r.pct < 10 ? 3 : 2)}%`;
        limitRowsHtml += `<tr>
            <td class="rate-cell" style="font-family:var(--font-mono);font-weight:600">${usedText}</td>
            <td><div class="item-cell">${itemIcon(r.itemId, gameData)}<span>${r.name}</span></div></td>
            <td>
                <div style="display:flex;align-items:center;gap:10px">
                    <div style="flex:1;min-width:140px">${renderLimitBar(r.used, r.limit)}</div>
                    <span style="font-size:12px;color:var(--text-secondary);white-space:nowrap">${pctText} of limit (${limitText})</span>
                </div>
            </td>
        </tr>`;
    }

    const surplus = balanceList.filter(i => i.net > 0.01).length;
    const deficit = balanceList.filter(i => i.net < -0.01).length;
    const totalItems = balanceList.length;
    const totalBuildings = factories.reduce((s, f) => s + (f.buildings || []).reduce((ss, b) => ss + (b.count || 1), 0), 0);

    let tableRows = '';
    if (balanceList.length === 0) {
        tableRows = `<tr><td colspan="5" class="empty-state" style="padding:40px">
            <div class="empty-state-icon">📦</div>
            <h3>No production data yet</h3>
            <p>Add factories manually or upload your save file to see your global resource balance.</p>
        </td></tr>`;
    } else {
        for (const item of balanceList) {
            const netClass = item.net > 0.01 ? 'rate-surplus' : item.net < -0.01 ? 'rate-deficit' : 'rate-balanced';
            const netPrefix = item.net > 0.01 ? '+' : '';
            const badgeClass = item.net > 0.01 ? 'badge-surplus' : item.net < -0.01 ? 'badge-deficit' : 'badge-balanced';
            const badgeText = item.net > 0.01 ? 'Surplus' : item.net < -0.01 ? 'Deficit' : 'Balanced';
            tableRows += `<tr>
                <td><div class="item-cell">
                    ${itemIcon(item.itemId, gameData)}
                    <span>${item.name}</span>
                </div></td>
                <td class="rate-cell rate-surplus">${item.produced > 0 ? fmtRate(item.produced, item.itemId, gameData) : '-'}</td>
                <td class="rate-cell rate-deficit">${item.consumed > 0 ? fmtRate(item.consumed, item.itemId, gameData) : '-'}</td>
                <td class="rate-cell ${netClass}">${netPrefix}${fmtRate(item.net, item.itemId, gameData)}</td>
                <td>${renderProgressBar(item.produced, item.consumed, item.itemId)}</td>
                <td style="display:none"><span class="badge ${badgeClass}">${badgeText}</span></td>
            </tr>`;
        }
    }

    return `
    <div class="fade-in">
        <div class="page-header">
            <div>
                <h1>Dashboard</h1>
                <p>Global resource overview across all your factories</p>
            </div>
        </div>

        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-label">Factories</div>
                <div class="stat-value">${factories.length}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Total Buildings</div>
                <div class="stat-value">${totalBuildings}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Items in Surplus</div>
                <div class="stat-value surplus">${surplus}</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Items in Deficit</div>
                <div class="stat-value deficit">${deficit}</div>
            </div>
        </div>

        <div class="card" style="margin-bottom:16px">
            <div class="card-header">
                <div>
                    <div class="card-title">World Resources</div>
                    <div class="card-subtitle">Map extraction limits and current usage</div>
                </div>
            </div>
            <div class="table-container" style="max-height:40vh;overflow-y:auto">
                <table>
                    <thead>
                        <tr>
                            <th style="width:120px">Used</th>
                            <th style="min-width:200px">Resource</th>
                            <th>% of Limit</th>
                        </tr>
                    </thead>
                    <tbody>${limitRowsHtml}</tbody>
                </table>
            </div>
        </div>

        <div class="card">
            <div class="card-header">
                <div>
                    <div class="card-title">Resource Balance</div>
                    <div class="card-subtitle">${totalItems} items tracked</div>
                </div>
                <div class="filters-bar" style="margin-bottom:0">
                    <button class="filter-chip active" data-filter="all">All</button>
                    <button class="filter-chip" data-filter="deficit">Deficit Only</button>
                    <button class="filter-chip" data-filter="surplus">Surplus Only</button>
                </div>
            </div>
            <div class="search-box" style="margin-bottom:16px">
                <input type="search" id="dashboard-search" placeholder="Search items..." />
            </div>
            <div class="table-container" style="max-height:60vh;overflow-y:auto">
                <table id="balance-table">
                    <thead>
                        <tr>
                            <th style="min-width:200px">Item</th>
                            <th>Production</th>
                            <th>Consumption</th>
                            <th>Net Balance</th>
                            <th>Usage</th>
                        </tr>
                    </thead>
                    <tbody id="balance-tbody">${tableRows}</tbody>
                </table>
            </div>
        </div>
    </div>`;
}

export function initDashboard() {
    const search = document.getElementById('dashboard-search');
    if (search) {
        search.addEventListener('input', () => {
            const q = search.value.toLowerCase();
            document.querySelectorAll('#balance-tbody tr').forEach(row => {
                const name = row.querySelector('.item-cell span')?.textContent?.toLowerCase() || '';
                row.style.display = name.includes(q) ? '' : 'none';
            });
        });
    }

    document.querySelectorAll('[data-filter]').forEach(chip => {
        chip.addEventListener('click', () => {
            document.querySelectorAll('[data-filter]').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            const filter = chip.dataset.filter;
            document.querySelectorAll('#balance-tbody tr').forEach(row => {
                if (filter === 'all') { row.style.display = ''; return; }
                const badge = row.querySelector('.badge')?.textContent?.toLowerCase() || '';
                row.style.display = badge === filter ? '' : 'none';
            });
        });
    });
}
