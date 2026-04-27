import { getState, fmt, fmtRate, itemIcon } from '../modules/state.js';

export function renderDashboard() {
    const { gameData, factories, saveData } = getState();

    // Compute global balance from user factories (skip countedInSave when save data is loaded)
    const balance = {};
    for (const factory of factories) {
        // Skip factories marked as "already counted in save" when save data exists
        if (factory.countedInSave && saveData) continue;

        for (const bld of (factory.buildings || [])) {
            if (!bld.recipeId || !gameData?.recipes[bld.recipeId]) continue;
            const recipe = gameData.recipes[bld.recipeId];
            const cyclesPerMin = recipe.manufacturingDuration > 0 ? 60 / recipe.manufacturingDuration : 0;
            const clock = (bld.clockSpeed || 100) / 100;
            const count = bld.count || 1;

            for (const ing of recipe.ingredients) {
                if (!balance[ing.itemId]) balance[ing.itemId] = { produced: 0, consumed: 0 };
                balance[ing.itemId].consumed += ing.amount * cyclesPerMin * clock * count;
            }
            for (const prod of recipe.products) {
                if (!balance[prod.itemId]) balance[prod.itemId] = { produced: 0, consumed: 0 };
                balance[prod.itemId].produced += prod.amount * cyclesPerMin * clock * count;
            }
        }
    }

    // Merge save data balance
    if (saveData?.globalBalance) {
        for (const item of saveData.globalBalance) {
            if (!balance[item.itemId]) balance[item.itemId] = { produced: 0, consumed: 0 };
            balance[item.itemId].produced += item.produced;
            balance[item.itemId].consumed += item.consumed;
        }
    }

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
                <td><span class="badge ${badgeClass}">${badgeText}</span></td>
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
                            <th>Status</th>
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
