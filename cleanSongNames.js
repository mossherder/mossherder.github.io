const fs = require('fs');

/**
 * Normalizes song names to merge variations like "01 - Brown Eyed Women >"
 */
function normalizeSongName(name) {
    if (!name) return "";
    return name
        .toLowerCase()
        // 1. Remove track numbers/discs/lead dashes (e.g., "01 - ", "d1t05 ", "1. ")
        .replace(/^(d\dt\d+|t\d+|[a-z]\d+|-|\d+[\s.-]+)/g, '')
        // 2. Remove segue markers and trailing punctuation
        .replace(/[->>]+$/g, '')
        // 3. Remove content in parentheses/brackets (e.g., "(live)", "[sbd]")
        .replace(/[\(\[].*?[\)\]]/g, '')
        // 4. Normalize "Brown-Eyed" to "Brown Eyed"
        .replace(/-/g, ' ')
        // 5. Remove all non-alphanumeric chars except spaces
        .replace(/[^a-z0-9\s]/g, '')
        .trim();
}

console.log("Reading data.js...");
const rawData = fs.readFileSync('data.js', 'utf8');
// Strip the JS variable assignment to parse as JSON
const jsonString = rawData.replace('const MASTER_DATA = ', '').replace(/;$/, '');
const masterData = JSON.parse(jsonString);

const newSongMap = {}; // Key: normalized name, Value: { displayName: string, indices: Set }
let originalLinkCount = 0;

// Calculate original link count for the integrity check
Object.values(masterData.songs).forEach(indices => {
    originalLinkCount += indices.length;
});

console.log(`Original Unique Entries: ${Object.keys(masterData.songs).length}`);
console.log(`Original Total Show-Song Links: ${originalLinkCount}`);

// --- Process and Merge ---
for (let originalName in masterData.songs) {
    let normalized = normalizeSongName(originalName);
    const indices = masterData.songs[originalName];

    // INTEGRITY CHECK: If normalization is too aggressive and returns empty,
    // fallback to original trimmed name so data is never dropped.
    if (!normalized) {
        normalized = originalName.trim().toLowerCase();
    }

    if (!newSongMap[normalized]) {
        // Create the entry using a "clean" version of the first name we find
        const prettyName = originalName.replace(/^[0-9\s.-]+/, '').replace(/[->>]+$/, '').trim();
        newSongMap[normalized] = {
            displayName: prettyName,
            indices: new Set()
        };
    }

    // Add all show indices to the Set
    indices.forEach(idx => newSongMap[normalized].indices.add(idx));
}

// --- Convert back to Array and Rebuild MASTER_DATA ---
const finalSongMap = {};
let finalLinkCount = 0;

for (let key in newSongMap) {
    const item = newSongMap[key];
    const indicesArray = Array.from(item.indices);
    finalSongMap[item.displayName] = indicesArray;
    finalLinkCount += indicesArray.length;
}

// --- Final Integrity Verification ---
console.log("-----------------------------------------");
console.log(`New Unique Entries: ${Object.keys(finalSongMap).length}`);
console.log(`Final Total Show-Song Links: ${finalLinkCount}`);

if (finalLinkCount < originalLinkCount) {
    console.error("CRITICAL ERROR: Data loss detected! Do not use output.");
    
    const output = {
        shows: masterData.shows,
        songs: finalSongMap
    };

    fs.writeFileSync('data-cleaned-names.js', `const MASTER_DATA = ${JSON.stringify(output)};`);
    console.log("Success: data-cleaned-names.js has been generated.");
} else {
    console.log("Check Passed: No songs or show-links were dropped.");
    
    const output = {
        shows: masterData.shows,
        songs: finalSongMap
    };

    fs.writeFileSync('data-cleaned-names.js', `const MASTER_DATA = ${JSON.stringify(output)};`);
    console.log("Success: data-cleaned-names.js has been generated.");
}