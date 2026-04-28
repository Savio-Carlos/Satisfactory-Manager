import express from 'express';
import cors from 'cors';
import multer from 'multer';
import https from 'https';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { parseSaveFile } from './services/saveParser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Multer for save file uploads
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 500 * 1024 * 1024 } // 500MB limit
});

// Load game data
const gameDataPath = join(__dirname, 'data', 'gameData.json');
let gameData = null;
try {
    gameData = JSON.parse(readFileSync(gameDataPath, 'utf-8'));
    console.log(`✓ Game data loaded: ${Object.keys(gameData.items).length} items, ${Object.keys(gameData.recipes).length} recipes`);
} catch (e) {
    console.error('✗ Failed to load game data:', e.message);
    process.exit(1);
}

// User data (factories, settings, unlocked alternates)
const userDataDir = join(__dirname, 'data');
const userDataPath = join(userDataDir, 'userData.json');
if (!existsSync(userDataDir)) mkdirSync(userDataDir, { recursive: true });

let userData = {
    factories: [],
    unlockedAlternates: [],
    settings: {
        savePath: '',
        theme: 'dark'
    }
};
if (existsSync(userDataPath)) {
    try {
        userData = { ...userData, ...JSON.parse(readFileSync(userDataPath, 'utf-8')) };
    } catch (e) {
        console.warn('Could not load user data, using defaults');
    }
}

function saveUserData() {
    writeFileSync(userDataPath, JSON.stringify(userData, null, 2));
}

// ===== API ROUTES =====

// -- Game Data --
app.get('/api/gamedata', (req, res) => {
    res.json(gameData);
});

app.get('/api/gamedata/items', (req, res) => {
    res.json(gameData.items);
});

app.get('/api/gamedata/recipes', (req, res) => {
    res.json(gameData.recipes);
});

app.get('/api/gamedata/buildings', (req, res) => {
    res.json(gameData.buildings);
});

// -- Factories (User Data) --
app.get('/api/factories', (req, res) => {
    res.json(userData.factories);
});

app.post('/api/factories', (req, res) => {
    const factory = {
        id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
        name: req.body.name || 'New Factory',
        description: req.body.description || '',
        buildings: req.body.buildings || [],
        countedInSave: req.body.countedInSave || false,
        sourcedInputs: (req.body.sourcedInputs && typeof req.body.sourcedInputs === 'object') ? req.body.sourcedInputs : {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
    userData.factories.push(factory);
    saveUserData();
    res.json(factory);
});

app.put('/api/factories/:id', (req, res) => {
    const idx = userData.factories.findIndex(f => f.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Factory not found' });
    
    userData.factories[idx] = {
        ...userData.factories[idx],
        ...req.body,
        id: req.params.id,
        updatedAt: new Date().toISOString()
    };
    saveUserData();
    res.json(userData.factories[idx]);
});

app.delete('/api/factories/:id', (req, res) => {
    const idx = userData.factories.findIndex(f => f.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Factory not found' });
    
    userData.factories.splice(idx, 1);
    saveUserData();
    res.json({ success: true });
});

// -- Unlocked Alternate Recipes --
app.get('/api/unlocked-alternates', (req, res) => {
    res.json(userData.unlockedAlternates || []);
});

app.put('/api/unlocked-alternates', (req, res) => {
    userData.unlockedAlternates = req.body.alternates || [];
    saveUserData();
    res.json(userData.unlockedAlternates);
});

// -- Save File Parsing --
app.post('/api/parse-save', upload.single('savefile'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No save file uploaded' });
    }

    try {
        console.log(`Parsing save file: ${req.file.originalname} (${(req.file.size / 1024 / 1024).toFixed(1)}MB)`);
        const result = await parseSaveFile(req.file.buffer, gameData);
        
        // Store unlocked alternates from save
        if (result.unlockedAlternates && result.unlockedAlternates.length > 0) {
            userData.unlockedAlternates = result.unlockedAlternates;
            saveUserData();
            console.log(`✓ Extracted ${result.unlockedAlternates.length} unlocked alternate recipes`);
        }
        
        res.json(result);
    } catch (e) {
        console.error('Save parse error:', e);
        res.status(500).json({ error: 'Failed to parse save file: ' + e.message });
    }
});

// -- Image proxy (avoids CDN hotlink protection) --
const imageCache = new Map();
app.get('/api/img', async (req, res) => {
    const url = req.query.url;
    if (!url || !url.startsWith('https://static.satisfactory-calculator.com/')) {
        return res.status(400).json({ error: 'Invalid image URL' });
    }

    // Check cache
    if (imageCache.has(url)) {
        const cached = imageCache.get(url);
        res.set('Content-Type', cached.contentType);
        res.set('Cache-Control', 'public, max-age=86400');
        return res.send(cached.data);
    }

    try {
        const data = await new Promise((resolve, reject) => {
            https.get(url, { headers: { 'Referer': 'https://satisfactory-calculator.com/' } }, (response) => {
                const chunks = [];
                response.on('data', chunk => chunks.push(chunk));
                response.on('end', () => resolve({ data: Buffer.concat(chunks), contentType: response.headers['content-type'] || 'image/png' }));
                response.on('error', reject);
            }).on('error', reject);
        });

        imageCache.set(url, data);
        res.set('Content-Type', data.contentType);
        res.set('Cache-Control', 'public, max-age=86400');
        res.send(data.data);
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch image' });
    }
});

// -- Persisted save state --
// The client parses .sav files locally, so we accept the digest of the parse here
// and persist it so the user doesn't have to re-upload after a page reload.
app.put('/api/save-state', (req, res) => {
    userData.lastSave = req.body || null;
    saveUserData();
    res.json({ ok: true });
});

app.get('/api/save-state', (req, res) => {
    res.json(userData.lastSave || null);
});

app.delete('/api/save-state', (req, res) => {
    userData.lastSave = null;
    saveUserData();
    res.json({ ok: true });
});

// -- Settings --
app.get('/api/settings', (req, res) => {
    res.json(userData.settings);
});

app.put('/api/settings', (req, res) => {
    userData.settings = { ...userData.settings, ...req.body };
    saveUserData();
    res.json(userData.settings);
});

// -- Production Calculator --
app.post('/api/calculate', (req, res) => {
    const { targetItemId, targetRate, recipeOverrides, availableInputs } = req.body;
    
    try {
        const result = calculateProductionChain(targetItemId, targetRate, recipeOverrides || {}, availableInputs || {}, gameData);
        res.json(result);
    } catch (e) {
        console.error('Calculation error:', e);
        res.status(500).json({ error: 'Calculation failed: ' + e.message });
    }
});

// Production chain calculator
function calculateProductionChain(targetItemId, targetRate, recipeOverrides, availableInputs, gameData) {
    const steps = {};
    const rawResources = {};
    const inputsUsed = {}; // track how much of availableInputs was used

    function resolve(itemId, rateNeeded, resolveStack = new Set()) {
        if (!rateNeeded || !isFinite(rateNeeded) || rateNeeded <= 0) return;

        // Check if we can satisfy this from availableInputs
        if (availableInputs[itemId] && availableInputs[itemId] > 0) {
            const available = availableInputs[itemId];
            if (rateNeeded <= available) {
                rawResources[itemId] = (rawResources[itemId] || 0) + rateNeeded;
                availableInputs[itemId] -= rateNeeded;
                return;
            } else {
                rawResources[itemId] = (rawResources[itemId] || 0) + available;
                rateNeeded -= available;
                availableInputs[itemId] = 0;
            }
        }

        // Circular dependency guard
        if (resolveStack.has(itemId)) {
            rawResources[itemId] = (rawResources[itemId] || 0) + rateNeeded;
            return;
        }

        // Check if this is a raw resource (no production recipes)
        const availableRecipes = gameData.itemRecipeMap[itemId];
        if (!availableRecipes || availableRecipes.length === 0) {
            rawResources[itemId] = (rawResources[itemId] || 0) + rateNeeded;
            return;
        }

        // Pick recipe (override or default)
        // Prefer: non-alternate recipes where this item is the primary product (first output)
        let recipeId = recipeOverrides[itemId];
        if (!recipeId) {
            // Best: non-alternate, primary product
            const primaryDefault = availableRecipes.find(rId => {
                const r = gameData.recipes[rId];
                return !r.isAlternate && r.products[0]?.itemId === itemId;
            });
            // Fallback: any non-alternate
            const anyDefault = availableRecipes.find(rId => !gameData.recipes[rId].isAlternate);
            recipeId = primaryDefault || anyDefault || availableRecipes[0];
        }

        const recipe = gameData.recipes[recipeId];
        if (!recipe) {
            rawResources[itemId] = (rawResources[itemId] || 0) + rateNeeded;
            return;
        }

        // Skip extraction/0-duration recipes — treat as raw resources
        if (!recipe.manufacturingDuration || recipe.manufacturingDuration <= 0) {
            rawResources[itemId] = (rawResources[itemId] || 0) + rateNeeded;
            return;
        }

        // Skip extraction buildings (Miners, Water Pumps, etc.) — rates depend on node purity
        const extractionBuildings = ['Build_MinerMk1_C', 'Build_MinerMk2_C', 'Build_MinerMk3_C',
            'Build_OilPump_C', 'Build_WaterPump_C', 'Build_FrackingSmasher_C', 'Build_FrackingExtractor_C'];
        if (recipe.producedIn.some(bId => extractionBuildings.includes(bId))) {
            rawResources[itemId] = (rawResources[itemId] || 0) + rateNeeded;
            return;
        }

        const targetProduct = recipe.products.find(p => p.itemId === itemId);
        if (!targetProduct || !targetProduct.amount) {
            rawResources[itemId] = (rawResources[itemId] || 0) + rateNeeded;
            return;
        }

        const cyclesPerMinute = 60 / recipe.manufacturingDuration;
        const outputPerMinute = targetProduct.amount * cyclesPerMinute;
        if (!outputPerMinute || !isFinite(outputPerMinute)) {
            rawResources[itemId] = (rawResources[itemId] || 0) + rateNeeded;
            return;
        }
        const multiplier = rateNeeded / outputPerMinute;

        const stepKey = `${recipeId}__${itemId}`;
        if (!steps[stepKey]) {
            steps[stepKey] = {
                recipeId,
                recipeName: recipe.name,
                targetItemId: itemId,
                machineCount: 0,
                buildingId: recipe.producedIn[0] || null,
                inputs: recipe.ingredients.map(ing => ({
                    itemId: ing.itemId,
                    ratePerMachine: ing.amount * cyclesPerMinute
                })),
                outputs: recipe.products.map(prod => ({
                    itemId: prod.itemId,
                    ratePerMachine: prod.amount * cyclesPerMinute
                }))
            };
        }
        steps[stepKey].machineCount += multiplier;

        // Resolve ingredients
        const childStack = new Set(resolveStack);
        childStack.add(itemId);
        for (const ingredient of recipe.ingredients) {
            const ingredientRate = ingredient.amount * cyclesPerMinute * multiplier;
            if (isFinite(ingredientRate) && ingredientRate > 0) {
                resolve(ingredient.itemId, ingredientRate, childStack);
            }
        }
    }

    resolve(targetItemId, targetRate);

    // Byproduct credit pass 1: reduce raw resource demand for items also produced as byproducts.
    for (const step of Object.values(steps)) {
        for (const out of step.outputs) {
            if (out.itemId === step.targetItemId) continue;
            if (!(out.itemId in rawResources)) continue;
            const byproductRate = out.ratePerMachine * step.machineCount;
            rawResources[out.itemId] = Math.max(0, rawResources[out.itemId] - byproductRate);
            if (rawResources[out.itemId] < 1e-6) delete rawResources[out.itemId];
        }
    }

    // Byproduct credit pass 2: if a byproduct satisfies an intermediate step's
    // target (e.g. Alumina Solution produces Silica which feeds Quartz Processing),
    // reduce that step's machine count and its raw resource consumption.
    for (const byproducerStep of Object.values(steps)) {
        for (const out of byproducerStep.outputs) {
            if (out.itemId === byproducerStep.targetItemId) continue;
            const byRate = out.ratePerMachine * byproducerStep.machineCount;
            if (byRate < 1e-6) continue;

            const targetEntry = Object.entries(steps).find(([, s]) => s.targetItemId === out.itemId);
            if (!targetEntry) continue;
            const [targetKey, targetStep] = targetEntry;

            const primaryOut = targetStep.outputs.find(o => o.itemId === out.itemId);
            if (!primaryOut || primaryOut.ratePerMachine <= 0) continue;

            const machineReduction = Math.min(targetStep.machineCount, byRate / primaryOut.ratePerMachine);
            targetStep.machineCount -= machineReduction;

            // Reduce raw resource inputs for the eliminated machines
            for (const inp of targetStep.inputs) {
                const reduction = inp.ratePerMachine * machineReduction;
                if (rawResources[inp.itemId] !== undefined) {
                    rawResources[inp.itemId] = Math.max(0, rawResources[inp.itemId] - reduction);
                    if (rawResources[inp.itemId] < 1e-6) delete rawResources[inp.itemId];
                }
                // One level deeper: if that input is itself an intermediate step
                const subEntry = Object.entries(steps).find(([, s]) => s.targetItemId === inp.itemId);
                if (subEntry) {
                    const [subKey, subStep] = subEntry;
                    const subPrimary = subStep.outputs.find(o => o.itemId === inp.itemId);
                    if (subPrimary && subPrimary.ratePerMachine > 0) {
                        const subReduction = reduction / subPrimary.ratePerMachine;
                        subStep.machineCount = Math.max(0, subStep.machineCount - subReduction);
                        for (const subInp of subStep.inputs) {
                            if (rawResources[subInp.itemId] !== undefined) {
                                rawResources[subInp.itemId] = Math.max(0, rawResources[subInp.itemId] - subInp.ratePerMachine * subReduction);
                                if (rawResources[subInp.itemId] < 1e-6) delete rawResources[subInp.itemId];
                            }
                        }
                        if (subStep.machineCount < 1e-6) delete steps[subKey];
                    }
                }
            }

            if (targetStep.machineCount < 1e-6) delete steps[targetKey];
        }
    }

    // Post-process: calculate proper machine counts with clock speeds
    const processedSteps = Object.values(steps).map(step => {
        const wholeMachines = Math.ceil(step.machineCount);
        const avgClock = (step.machineCount / wholeMachines) * 100;
        return {
            ...step,
            machineCountRaw: step.machineCount,
            machineCount: wholeMachines,
            clockSpeed: Math.round(avgClock * 100) / 100,
            totalInputs: step.inputs.map(inp => ({
                ...inp,
                totalRate: inp.ratePerMachine * step.machineCount
            })),
            totalOutputs: step.outputs.map(out => ({
                ...out,
                totalRate: out.ratePerMachine * step.machineCount
            }))
        };
    });

    // Calculate total power
    let totalPower = 0;
    for (const step of processedSteps) {
        if (step.buildingId && gameData.buildings[step.buildingId]) {
            totalPower += (gameData.buildings[step.buildingId].powerUsed || 0) * step.machineCountRaw;
        }
    }

    return {
        targetItemId,
        targetRate,
        steps: processedSteps,
        rawResources,
        totalPower,
        totalMachines: processedSteps.reduce((sum, s) => sum + s.machineCount, 0)
    };
}

// -- Serve Frontend in Production --
if (process.env.NODE_ENV === 'production' || process.env.DIGITALOCEAN === 'true') {
    const distPath = join(__dirname, '../dist');
    app.use(express.static(distPath));
    
    // SPA fallback
    app.get('*', (req, res) => {
        if (req.path.startsWith('/api')) {
            return res.status(404).json({ error: 'API route not found' });
        }
        res.sendFile(join(distPath, 'index.html'));
    });
}

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🏭 Satisfactory Manager API running at http://0.0.0.0:${PORT}`);
    console.log(`   Game data: ${Object.keys(gameData.items).length} items, ${Object.keys(gameData.recipes).length} recipes\n`);
});
