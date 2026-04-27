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
