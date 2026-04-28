// Global state management
const state = {
    gameData: null,
    factories: [],
    saveData: null,
    unlockedAlternates: [],
    currentPage: 'dashboard',
    listeners: new Map()
};

export function getState() { return state; }

export function setState(key, value) {
    state[key] = value;
    const cbs = state.listeners.get(key) || [];
    cbs.forEach(cb => cb(value));
}

export function onStateChange(key, callback) {
    if (!state.listeners.has(key)) state.listeners.set(key, []);
    state.listeners.get(key).push(callback);
}

// Toast notifications
export function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; toast.style.transform = 'translateX(40px)'; setTimeout(() => toast.remove(), 300); }, 3000);
}

// Modal
export const RAW_LIMITS = {
    'Desc_OreBauxite_C': 12300,
    'Desc_OreGold_C': 15000,
    'Desc_Coal_C': 42300,
    'Desc_OreCopper_C': 36900,
    'Desc_LiquidOil_C': 12600,
    'Desc_OreIron_C': 92100,
    'Desc_Stone_C': 69900,
    'Desc_NitrogenGas_C': 12000,
    'Desc_RawQuartz_C': 13500,
    'Desc_SAM_C': 10200,
    'Desc_Sulfur_C': 10800,
    'Desc_OreUranium_C': 2100,
    'Desc_Water_C': Infinity
};

export function renderProgressBar(produced, consumed, itemId) {
    const isWater = itemId === 'Desc_Water_C';
    if (isWater) {
        return `<div style="display:flex;align-items:center;gap:8px;min-width:100px">
            <div style="flex:1;height:8px;background:var(--bg-input);border-radius:4px;overflow:hidden">
                <div style="height:100%;width:100%;background:var(--accent-blue)"></div>
            </div>
            <span style="font-size:12px;color:var(--text-secondary);width:40px;text-align:right">∞</span>
        </div>`;
    }
    
    const limit = RAW_LIMITS[itemId];
    const max = limit !== undefined ? limit : produced;
    
    if (max <= 0) {
        if (consumed > 0) {
            return `<div style="display:flex;align-items:center;gap:8px;min-width:100px">
                <div style="flex:1;height:8px;background:var(--bg-input);border-radius:4px;overflow:hidden">
                    <div style="height:100%;width:100%;background:var(--color-deficit)"></div>
                </div>
                <span style="font-size:12px;color:var(--color-deficit);width:40px;text-align:right">100%</span>
            </div>`;
        }
        return `<span style="font-size:12px;color:var(--text-muted)">-</span>`;
    }
    
    const pct = Math.min(100, Math.max(0, (consumed / max) * 100));
    const color = pct > 99 ? 'var(--color-deficit)' : (pct > 80 ? 'var(--color-balanced)' : 'var(--color-surplus)');
    
    return `<div style="display:flex;align-items:center;gap:8px;min-width:100px">
        <div style="flex:1;height:8px;background:var(--bg-input);border-radius:4px;overflow:hidden">
            <div style="height:100%;width:${pct}%;background:${color};transition:width 0.3s ease"></div>
        </div>
        <span style="font-size:12px;color:${color};width:40px;text-align:right">${Math.round(pct)}%</span>
    </div>`;
}

export function showModal(html) {
    document.getElementById('modal-container').innerHTML = html;
    document.getElementById('modal-overlay').classList.remove('hidden');
}
export function hideModal() {
    document.getElementById('modal-overlay').classList.add('hidden');
}

// Format number
export function fmt(n, decimals = 2) {
    if (n == null || isNaN(n)) return '0';
    if (!isFinite(n)) return '∞';
    if (n === 0) return '0';
    if (Math.abs(n) < 0.01) return n.toFixed(4);
    return n.toFixed(decimals).replace(/\.?0+$/, '');
}

/**
 * Format a rate value with proper units.
 * Fluids are divided by 1000 (mL→m³) and show m³/min.
 * Solids show items/min.
 */
export function fmtRate(rate, itemId, gameData) {
    if (rate == null || isNaN(rate)) return '0/min';
    if (!isFinite(rate)) return '∞/min';
    const item = gameData?.items?.[itemId];
    const isFluid = item && (item.form === 'liquid' || item.form === 'gas');
    if (isFluid) {
        return fmt(rate / 1000) + ' m³/min';
    }
    return fmt(rate) + '/min';
}

/**
 * Check if an item is a fluid (liquid or gas)
 */
export function isFluid(itemId, gameData) {
    const item = gameData?.items?.[itemId];
    return item && (item.form === 'liquid' || item.form === 'gas');
}

/**
 * Get proxied image URL for an item.
 * Routes through our backend to bypass CDN hotlinking.
 */
export function getImageUrl(imageUrl) {
    if (!imageUrl) return null;
    // Proxy through our backend
    return `/api/img?url=${encodeURIComponent(imageUrl)}`;
}

/**
 * Render an item icon img tag
 */
export function itemIcon(itemId, gameData, size = 32, cls = 'item-icon') {
    const item = gameData?.items?.[itemId];
    if (!item?.image) return `<div class="${cls}" style="width:${size}px;height:${size}px"></div>`;
    const url = getImageUrl(item.image);
    return `<img src="${url}" class="${cls}" style="width:${size}px;height:${size}px" alt="${item.name || ''}" loading="lazy">`;
}

/**
 * Render a building icon img tag
 */
export function buildingIcon(buildingId, gameData, size = 28) {
    const bld = gameData?.buildings?.[buildingId];
    if (!bld?.image) return `<div class="item-icon" style="width:${size}px;height:${size}px"></div>`;
    const url = getImageUrl(bld.image);
    return `<img src="${url}" class="item-icon" style="width:${size}px;height:${size}px" alt="${bld.name || ''}" loading="lazy">`;
}

/**
 * Compute global balance from user factories and save data
 */
export function computeGlobalBalance(customFactories = null, includeSaveData = true) {
    const { gameData, factories, saveData } = getState();
    const balance = {};
    const targetFactories = customFactories || factories;

    for (const factory of targetFactories) {
        if (includeSaveData && factory.countedInSave && saveData) continue;

        const local = {};
        for (const bld of (factory.buildings || [])) {
            if (!bld.recipeId || !gameData?.recipes[bld.recipeId]) continue;
            const recipe = gameData.recipes[bld.recipeId];
            const cyclesPerMin = recipe.manufacturingDuration > 0 ? 60 / recipe.manufacturingDuration : 0;
            const clock = (bld.clockSpeed || 100) / 100;
            const count = bld.count || 1;

            for (const ing of recipe.ingredients) {
                if (!local[ing.itemId]) local[ing.itemId] = { produced: 0, consumed: 0 };
                local[ing.itemId].consumed += ing.amount * cyclesPerMin * clock * count;
            }
            for (const prod of recipe.products) {
                if (!local[prod.itemId]) local[prod.itemId] = { produced: 0, consumed: 0 };
                local[prod.itemId].produced += prod.amount * cyclesPerMin * clock * count;
            }
        }

        for (const [itemId, b] of Object.entries(local)) {
            if (!balance[itemId]) balance[itemId] = { produced: 0, consumed: 0 };
            
            const net = b.produced - b.consumed;
            const isSourced = factory.sourcedInputs && factory.sourcedInputs.includes(itemId);
            
            if (net > 0) {
                balance[itemId].produced += net;
            } else if (net < -0.001) {
                // Only drain from global grid if explicitly sourced!
                if (isSourced) {
                    balance[itemId].consumed += Math.abs(net);
                }
            }
        }
    }

    if (includeSaveData && saveData?.globalBalance) {
        for (const item of saveData.globalBalance) {
            if (!balance[item.itemId]) balance[item.itemId] = { produced: 0, consumed: 0 };
            balance[item.itemId].produced += item.produced;
            balance[item.itemId].consumed += item.consumed;
        }
    }

    return balance;
}
