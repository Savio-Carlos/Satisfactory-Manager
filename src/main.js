import { api } from './modules/api.js';
import { setState, getState, showToast } from './modules/state.js';
import { renderDashboard, initDashboard } from './components/dashboard.js';
import { renderFactories, initFactories } from './components/factories.js';
import { renderPlanner, initPlanner } from './components/planner.js';
import { renderSaveFile, initSaveFile } from './components/savefile.js';
import { renderSettings, initSettings } from './components/settings.js';

const pages = {
    dashboard: { render: renderDashboard, init: initDashboard },
    factories: { render: renderFactories, init: initFactories },
    planner:   { render: renderPlanner,   init: initPlanner },
    savefile:  { render: renderSaveFile,   init: initSaveFile },
    settings:  { render: renderSettings,   init: initSettings }
};

function navigateTo(page) {
    setState('currentPage', page);

    // Update nav
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.toggle('active', link.dataset.page === page);
    });

    // Render page
    const pageContent = document.getElementById('page-content');
    const p = pages[page];
    if (p) {
        pageContent.innerHTML = p.render();
        p.init();
    }
}

// Navigation
document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        navigateTo(link.dataset.page);
    });
});

// Modal close on overlay click
document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
        document.getElementById('modal-overlay').classList.add('hidden');
    }
});

// Escape to close modal
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        document.getElementById('modal-overlay').classList.add('hidden');
    }
});

// Initialize app
async function init() {
    const content = document.getElementById('page-content');
    content.innerHTML = '<div class="loading-overlay"><div class="loading-spinner"></div>Loading Satisfactory Manager...</div>';

    try {
        const [gameData, factories, unlockedAlternates, savedState] = await Promise.all([
            api.getGameData(),
            api.getFactories(),
            api.getUnlockedAlternates().catch(() => []),
            api.getSaveState().catch(() => null)
        ]);

        setState('gameData', gameData);
        setState('factories', factories);
        setState('unlockedAlternates', unlockedAlternates);
        if (savedState) setState('saveData', savedState);

        console.log(`✓ Loaded ${Object.keys(gameData.items).length} items, ${Object.keys(gameData.recipes).length} recipes, ${unlockedAlternates.length} unlocked alternates`);
        navigateTo('dashboard');
    } catch (err) {
        console.error('Failed to initialize:', err);
        content.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">⚠️</div>
                <h3>Failed to connect to server</h3>
                <p>Make sure the backend is running on port 3001.<br>Run <code style="color:var(--accent-orange)">npm run dev</code> to start both servers.</p>
                <button class="btn btn-primary" onclick="location.reload()">Retry</button>
            </div>`;
    }
}

init();
