import { parseSaveFile } from './server/services/saveParser.js';
import { readFileSync } from 'fs';

const gameData = JSON.parse(readFileSync('./server/data/gameData.json', 'utf8'));

// Get file path from command line
const file = process.argv[2];

if (file) {
    console.time('parse');
    const buffer = readFileSync(file);
    const result = await parseSaveFile(buffer, gameData);
    console.timeEnd('parse');
    console.log(`Buildings: ${result.totalBuildings}`);
} else {
    console.log("No file provided");
}
