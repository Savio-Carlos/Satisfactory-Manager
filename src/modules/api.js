// API helper module
const API_BASE = '/api';

async function request(path, options = {}) {
    const res = await fetch(`${API_BASE}${path}`, {
        headers: { 'Content-Type': 'application/json', ...options.headers },
        ...options
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || 'Request failed');
    }
    return res.json();
}

export const api = {
    getGameData: () => request('/gamedata'),
    getItems: () => request('/gamedata/items'),
    getRecipes: () => request('/gamedata/recipes'),
    getBuildings: () => request('/gamedata/buildings'),

    getFactories: () => request('/factories'),
    createFactory: (data) => request('/factories', { method: 'POST', body: JSON.stringify(data) }),
    updateFactory: (id, data) => request(`/factories/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    deleteFactory: (id) => request(`/factories/${id}`, { method: 'DELETE' }),

    getUnlockedAlternates: () => request('/unlocked-alternates'),
    updateUnlockedAlternates: (list) => request('/unlocked-alternates', { method: 'PUT', body: JSON.stringify({ alternates: list }) }),

    parseSaveFile: async (file) => {
        const formData = new FormData();
        formData.append('savefile', file);
        const res = await fetch(`${API_BASE}/parse-save`, { method: 'POST', body: formData });
        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: res.statusText }));
            throw new Error(err.error || 'Upload failed');
        }
        return res.json();
    },

    calculate: (targetItemId, targetRate, recipeOverrides, availableInputs) =>
        request('/calculate', { method: 'POST', body: JSON.stringify({ targetItemId, targetRate, recipeOverrides, availableInputs }) }),

    getSettings: () => request('/settings'),
    updateSettings: (data) => request('/settings', { method: 'PUT', body: JSON.stringify(data) }),

    getSaveState: () => request('/save-state'),
    putSaveState: (data) => request('/save-state', { method: 'PUT', body: JSON.stringify(data) }),
    deleteSaveState: () => request('/save-state', { method: 'DELETE' })
};
