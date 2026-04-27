import { Parser } from '@etothepii/satisfactory-file-parser';

export async function parseSaveFileLocal(file, gameData) {
    const arrayBuffer = await file.arrayBuffer();
    
    // Parse using the library
    const save = Parser.ParseSave('UserSave', arrayBuffer, {
        throwErrors: false
    });

    const allObjects = Object.values(save.levels).flatMap(level => level.objects);
    const unlockedAlternates = extractUnlockedAlternates(allObjects, gameData);

    const productionBuildings = [];
    const buildingTypePathMap = {};
    for (const [bldId, bld] of Object.entries(gameData.buildings)) {
        if (bld.className) {
            buildingTypePathMap[bld.className] = bldId;
        }
    }

    for (const obj of allObjects) {
        if (!obj.typePath) continue;

        let buildingId = null;
        for (const [className, bldId] of Object.entries(buildingTypePathMap)) {
            if (obj.typePath.includes(className.split('/').slice(-1)[0].split('.')[0])) {
                buildingId = bldId;
                break;
            }
        }

        if (!buildingId) {
            const productionPatterns = [
                'ConstructorMk1', 'AssemblerMk1', 'ManufacturerMk1',
                'SmelterMk1', 'FoundryMk1', 'OilRefinery', 'Packager',
                'Blender', 'HadronCollider', 'QuantumEncoder', 'Converter',
                'MinerMk1', 'MinerMk2', 'MinerMk3',
                'OilPump', 'WaterPump', 'FrackingSmasher', 'FrackingExtractor'
            ];

            for (const pattern of productionPatterns) {
                if (obj.typePath.includes(pattern)) {
                    for (const [bldId, bld] of Object.entries(gameData.buildings)) {
                        if (bldId.includes(pattern) || (bld.className && bld.className.includes(pattern))) {
                            buildingId = bldId;
                            break;
                        }
                    }
                    break;
                }
            }
        }

        if (!buildingId) continue;

        let recipeClassName = null;
        let recipeId = null;
        let recipeName = null;
        
        if (obj.properties) {
            const recipeProp = obj.properties.mCurrentRecipe;
            if (recipeProp) {
                if (recipeProp.value && recipeProp.value.pathName) {
                    recipeClassName = recipeProp.value.pathName;
                } else if (typeof recipeProp === 'object' && recipeProp.pathName) {
                    recipeClassName = recipeProp.pathName;
                }

                if (recipeClassName) {
                    recipeId = gameData.recipeClassNameToId[recipeClassName];
                    if (recipeId && gameData.recipes[recipeId]) {
                        recipeName = gameData.recipes[recipeId].name;
                    }
                }
            }
        }

        let clockSpeed = 100;
        if (obj.properties) {
            const potential = obj.properties.mCurrentPotential || obj.properties.mPendingPotential;
            if (potential) {
                if (typeof potential === 'object' && potential.value !== undefined) {
                    clockSpeed = potential.value * 100;
                } else if (typeof potential === 'number') {
                    clockSpeed = potential * 100;
                }
            }
        }

        let productionBoost = 0;
        if (obj.properties && obj.properties.mCurrentProductionBoost) {
            const boost = obj.properties.mCurrentProductionBoost;
            if (typeof boost === 'object' && boost.value !== undefined) {
                productionBoost = boost.value;
            } else if (typeof boost === 'number') {
                productionBoost = boost;
            }
        }

        let position = null;
        if (obj.transform && obj.transform.translation) {
            position = {
                x: obj.transform.translation.x,
                y: obj.transform.translation.y,
                z: obj.transform.translation.z
            };
        }

        productionBuildings.push({
            instanceName: obj.instanceName,
            buildingId,
            buildingName: gameData.buildings[buildingId]?.name || buildingId,
            typePath: obj.typePath,
            recipeId,
            recipeName,
            recipeClassName,
            clockSpeed,
            productionBoost,
            position
        });
    }

    const buildingsWithRates = productionBuildings.map(bld => {
        if (!bld.recipeId || !gameData.recipes[bld.recipeId]) {
            return { ...bld, inputs: [], outputs: [] };
        }

        const recipe = gameData.recipes[bld.recipeId];
        const cyclesPerMinute = recipe.manufacturingDuration > 0 ? 60 / recipe.manufacturingDuration : 0;
        const clockMultiplier = bld.clockSpeed / 100;
        const boostMultiplier = 1 + bld.productionBoost;

        const inputs = recipe.ingredients.map(ing => ({
            itemId: ing.itemId,
            itemName: gameData.items[ing.itemId]?.name || ing.itemId,
            rate: ing.amount * cyclesPerMinute * clockMultiplier
        }));

        const outputs = recipe.products.map(prod => ({
            itemId: prod.itemId,
            itemName: gameData.items[prod.itemId]?.name || prod.itemId,
            rate: prod.amount * cyclesPerMinute * clockMultiplier * boostMultiplier
        }));

        return { ...bld, inputs, outputs };
    });

    const globalBalance = {};
    for (const bld of buildingsWithRates) {
        for (const input of bld.inputs) {
            if (!globalBalance[input.itemId]) {
                globalBalance[input.itemId] = { itemId: input.itemId, itemName: input.itemName, produced: 0, consumed: 0 };
            }
            globalBalance[input.itemId].consumed += input.rate;
        }
        for (const output of bld.outputs) {
            if (!globalBalance[output.itemId]) {
                globalBalance[output.itemId] = { itemId: output.itemId, itemName: output.itemName, produced: 0, consumed: 0 };
            }
            globalBalance[output.itemId].produced += output.rate;
        }
    }

    for (const item of Object.values(globalBalance)) {
        item.net = item.produced - item.consumed;
    }

    return {
        totalBuildings: productionBuildings.length,
        buildings: buildingsWithRates,
        globalBalance: Object.values(globalBalance).sort((a, b) => a.itemName.localeCompare(b.itemName)),
        unlockedAlternates,
        saveInfo: {
            header: save.header ? {
                sessionName: save.header.sessionName,
                playDuration: save.header.playDurationSeconds,
                saveDateTime: save.header.saveDateTime
            } : null,
            levelCount: Object.keys(save.levels).length
        }
    };
}

function extractUnlockedAlternates(allObjects, gameData) {
    const unlockedRecipeIds = new Set();
    for (const obj of allObjects) {
        if (!obj.typePath || !obj.properties) continue;
        if (obj.typePath.includes('SchematicManager') || obj.typePath.includes('GamePhaseManager')) {
            const purchased = obj.properties.mPurchasedSchematics;
            if (purchased && Array.isArray(purchased)) {
                for (const schematic of purchased) {
                    const pathName = schematic?.pathName || schematic?.value?.pathName || schematic;
                    if (typeof pathName === 'string' && pathName.includes('Alternate')) {
                        const shortName = pathName.split('.').pop()?.replace('Schematic_', 'Recipe_');
                        if (shortName) {
                            for (const [recipeId, recipe] of Object.entries(gameData.recipes)) {
                                if (recipe.isAlternate && recipeId.includes(shortName.replace('Recipe_', '').replace('_C', ''))) {
                                    unlockedRecipeIds.add(recipeId);
                                }
                            }
                        }
                    }
                }
            }
            const availableRecipes = obj.properties.mAvailableRecipes;
            if (availableRecipes && Array.isArray(availableRecipes)) {
                for (const recipe of availableRecipes) {
                    const pathName = recipe?.pathName || recipe?.value?.pathName || recipe;
                    if (typeof pathName === 'string') {
                        const id = gameData.recipeClassNameToId[pathName];
                        if (id && gameData.recipes[id]?.isAlternate) {
                            unlockedRecipeIds.add(id);
                        }
                    }
                }
            }
        }
        if (obj.typePath.includes('RecipeManager')) {
            const availableRecipes = obj.properties.mAvailableRecipes;
            if (availableRecipes && Array.isArray(availableRecipes)) {
                for (const recipe of availableRecipes) {
                    const pathName = recipe?.pathName || recipe?.value?.pathName || recipe;
                    if (typeof pathName === 'string') {
                        const id = gameData.recipeClassNameToId[pathName];
                        if (id && gameData.recipes[id]?.isAlternate) {
                            unlockedRecipeIds.add(id);
                        }
                    }
                }
            }
        }
    }
    return Array.from(unlockedRecipeIds);
}
