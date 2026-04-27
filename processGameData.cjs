/**
 * Process raw game data from satisfactory-calculator.com into a clean format
 * for the Satisfactory Manager app.
 */
const fs = require('fs');
const path = require('path');

const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'raw_gameData.json'), 'utf-8'));

// Helper: extract short ID from a full class path
// e.g. "/Game/.../Desc_IronIngot.Desc_IronIngot_C" -> "Desc_IronIngot_C"
function shortId(classPath) {
    if (!classPath) return classPath;
    const parts = classPath.split('.');
    return parts[parts.length - 1] || classPath;
}

// Helper: extract building short ID from class path
// e.g. "/Game/.../Build_SmelterMk1.Build_SmelterMk1_C" -> "Build_SmelterMk1_C"
function buildingShortId(classPath) {
    return shortId(classPath);
}

// --- ITEMS ---
const items = {};
if (raw.itemsData) {
    for (const [id, item] of Object.entries(raw.itemsData)) {
        items[id] = {
            id,
            name: item.name || id,
            description: (item.description || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, ''),
            stackSize: item.stack || null,
            sinkPoints: item.resourceSinkPoints || 0,
            form: item.category === 'liquid' ? 'liquid' : (item.category === 'gas' ? 'gas' : 'solid'),
            image: item.image || null,
            category: item.category || 'unknown',
            color: item.color || null,
            className: item.className || ''
        };
    }
}

// --- BUILDINGS ---
const buildings = {};
const productionBuildingClassNames = new Map(); // className -> shortId
if (raw.buildingsData) {
    for (const [id, bld] of Object.entries(raw.buildingsData)) {
        if (bld.category === 'production' || bld.category === 'extraction') {
            buildings[id] = {
                id,
                name: bld.name || id,
                description: (bld.description || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, ''),
                category: bld.category,
                powerUsed: bld.powerUsed || 0,
                image: bld.image || null,
                className: bld.className || ''
            };
            if (bld.className) {
                productionBuildingClassNames.set(bld.className, id);
            }
        }
        if (bld.category === 'generator') {
            buildings[id] = {
                id,
                name: bld.name || id,
                description: (bld.description || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, ''),
                category: bld.category,
                powerGenerated: bld.powerGenerated || 0,
                image: bld.image || null,
                className: bld.className || ''
            };
        }
    }
}

// --- RECIPES ---
const recipes = {};
if (raw.recipesData) {
    for (const [id, recipe] of Object.entries(raw.recipesData)) {
        // Parse ingredients (keys are full class paths)
        const ingredients = [];
        if (recipe.ingredients) {
            for (const [classPath, amount] of Object.entries(recipe.ingredients)) {
                const itemId = shortId(classPath);
                ingredients.push({ itemId, amount: Number(amount) });
            }
        }

        // Parse products (field is "produce")
        const products = [];
        if (recipe.produce) {
            for (const [classPath, amount] of Object.entries(recipe.produce)) {
                const itemId = shortId(classPath);
                products.push({ itemId, amount: Number(amount) });
            }
        }

        // Determine which building produces this (field is "mProducedIn")
        const producedIn = [];
        if (recipe.mProducedIn && Array.isArray(recipe.mProducedIn)) {
            for (const classPath of recipe.mProducedIn) {
                const bldId = productionBuildingClassNames.get(classPath);
                if (bldId) {
                    producedIn.push(bldId);
                }
            }
        }

        const hasMachineProducer = producedIn.length > 0;

        const isAlternate = recipe.isAlternate === true || 
                           (recipe.name && recipe.name.startsWith('Alternate:')) ||
                           id.includes('Alternate');

        recipes[id] = {
            id,
            name: recipe.name || id,
            ingredients,
            products,
            manufacturingDuration: recipe.mManufactoringDuration || 0,
            producedIn,
            isAlternate,
            isMachineRecipe: hasMachineProducer,
            forBuilding: recipe.mForBuilding === true || false
        };
    }
}

// --- Build mapping: item -> recipes that produce it ---
const itemRecipeMap = {};
for (const [recipeId, recipe] of Object.entries(recipes)) {
    if (!recipe.isMachineRecipe) continue;
    for (const product of recipe.products) {
        if (!itemRecipeMap[product.itemId]) {
            itemRecipeMap[product.itemId] = [];
        }
        itemRecipeMap[product.itemId].push(recipeId);
    }
}

// --- Build mapping: className -> shortId for save file parsing ---
const classNameToId = {};
for (const [id, item] of Object.entries(items)) {
    if (item.className) {
        classNameToId[item.className] = id;
    }
}
for (const [id, bld] of Object.entries(buildings)) {
    if (bld.className) {
        classNameToId[bld.className] = id;
    }
}

// --- Build recipe className mapping for save file ---
const recipeClassNameToId = {};
if (raw.recipesData) {
    for (const [id, recipe] of Object.entries(raw.recipesData)) {
        if (recipe.className) {
            recipeClassNameToId[recipe.className] = id;
        }
    }
}

const gameData = {
    version: raw.branch || 'Stable',
    items,
    buildings,
    recipes,
    itemRecipeMap,
    classNameToId,
    recipeClassNameToId
};

// Write processed data
const outputDir = path.join(__dirname, 'server', 'data');
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, 'gameData.json'), JSON.stringify(gameData));

// Stats
const totalItems = Object.keys(items).length;
const totalRecipes = Object.keys(recipes).length;
const machineRecipes = Object.values(recipes).filter(r => r.isMachineRecipe).length;
const alternateRecipes = Object.values(recipes).filter(r => r.isAlternate).length;
const totalBuildings = Object.keys(buildings).length;

console.log('=== Game Data Processing Complete ===');
console.log(`Items: ${totalItems}`);
console.log(`Buildings: ${totalBuildings}`);
console.log(`Total Recipes: ${totalRecipes}`);
console.log(`Machine Recipes: ${machineRecipes}`);
console.log(`Alternate Recipes: ${alternateRecipes}`);
console.log(`Items with production recipes: ${Object.keys(itemRecipeMap).length}`);
console.log(`Output: ${path.join(outputDir, 'gameData.json')}`);
