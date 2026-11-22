// Builds data-cleaned-names.js from data.js (the titles as sourced from archive.org).
// data.js is never modified.
//
// Every archive.org track title is mapped to an official song from songCatalog.js.
// Titles that aren't an official song (tunings, banter, interviews, untitled tracks...)
// go under EXTRAS. A title naming several songs ("Scarlet Begonias > Fire On The Mountain")
// counts toward each of them.
//
// Output: MASTER_DATA_CLEANED = { shows, songs, extras } where songs maps an official title
// to its performances. A performance is a show index, or [showIndex, archiveTitle] when the
// official title alone wouldn't find the track in that show's file list (the page matches
// tracks by name). extras names the one catch-all entry, which the page lists last.
//
// Run: node cleanSongNames.js  (add --report to list how every title was mapped)

const fs = require('fs');
const catalog = require('./songCatalog.js');

const EXTRAS = 'Tunings, Interviews, Extras';

// Titles that look like an official song to the matcher but aren't one
const NOT_SONGS = ['Good Times Blues', 'Revolutionary Hamstrung Blues'].map(t => t.toLowerCase());

// The page's own track-matching normalization (index.html normalizeSongName)
const pageNorm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');

// Looser key for comparing titles: no case, punctuation, spaces, accents or a leading
// "The"; "&" is "and"; "-ing" and "-in'" are the same.
function key(s) {
    return s
        .replace(/[^\x00-\x7f]/g, '')          // mojibake like "DonÃÂÃÂt"
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/\bsaint\b/g, 'st')
        .replace(/[^a-z0-9 ]/g, '')
        .replace(/ing\b/g, 'in')                // trucking / truckin' -> truckin
        .trim()
        .replace(/^the /, '')
        .replace(/\s+/g, '');
}

// Strips everything around the song name: file extensions, timestamps, track/disc/set
// numbers, show-date prefixes, "Encore:", bracketed notes and segue arrows.
function clean(title) {
    let s = title
        .replace(/[^\x00-\x7f]/g, "'")
        .replace(/'{2,}/g, "'")
        .replace(/\.(mp3|flac|shn|wav|ogg)\b/gi, '')
        .replace(/\([^)]*\)|\[[^\]]*\]|\{[^}]*\}/g, ' ')
        .replace(/&gt;/g, '>')
        .replace(/"/g, '')
        .trim();
    let prev;
    do {
        prev = s;
        s = s
            .replace(/^\d{1,2}:\d{2}(:\d{2})?\s*/, '')                         // 04:40
            .replace(/^gd\d{2,4}[-.]\d{2}[-.]\d{2}\w*?(?=\s|$)\s*/i, '')          // gd73-12-08, gd1981-10-04s1t01
            .replace(/^(sbd)?(s\d|set\s?\d|d\d|cd\d|disc\s?\d)?\s*t(rack)?\s?\d+\b[\s.:-]*/i, '') // s1t05, d1t05, t10
            .replace(/^(s\d|d\d)\s+/i, '')
            .replace(/^\d{1,3}(?![\d:])\s*[-.):]?\s+/, '')                        // 01 - , 5.
            .replace(/^\d{1,3}\s*[-.)]\s*/, '')
            .replace(/^(e\d?|enc|encore|encore break)\s*:\s*/i, '')
            .replace(/\s+(#\s?\d+|take\s+\w+|x\s?\d+)$/i, '')                      // "#2", "take 3", "x 2"
            .replace(/^[\s>\-:;*#/]+/, '')
            .replace(/[\s>\-;,*#/\\:]+$/, '')
            .trim();
    } while (s !== prev);
    return s;
}

// Lookup tables from the catalog
const exact = new Map();  // key -> official title
for (const official in catalog) {
    for (const name of [official, ...catalog[official]]) {
        const k = key(name);
        if (exact.has(k) && exact.get(k) !== official) {
            throw new Error(`"${name}" is listed under both "${exact.get(k)}" and "${official}"`);
        }
        exact.set(k, official);
    }
}
// Longest first, so "It's All Over Now, Baby Blue" wins over "It's All Over Now"
const prefixes = [...exact.keys()].filter(k => k.length >= 6).sort((a, b) => b.length - a.length);

// One song name -> official title, or null
function matchOne(name) {
    const c = clean(name);
    if (!c) return null;
    const k = key(c);
    if (exact.has(k)) return { song: exact.get(k), how: 'exact' };
    // "Dark Star Jam", "Playin' Reprise", "Weather Report Suite Part 1"...
    const bare = c.replace(/\s+(jam|reprise|intro|instrumental|tease|part\s*\d+|part\s*one|pt\.?\s*\d+|prelude|fragment|segment|w\/.*|with .*)$/i, '');
    if (bare !== c && exact.has(key(bare))) return { song: exact.get(key(bare)), how: 'exact' };
    const p = prefixes.find(p => k.startsWith(p));
    if (p) return { song: exact.get(p), how: 'prefix' };
    // Typos: "Throwning Stones", "Sugara Magnolia", "Teerrapin Station"
    for (const t of new Set([k, key(bare)])) {
        if (t.length < 7) continue;
        const allowed = t.length >= 12 ? 2 : 1;
        let best = null, bestD = allowed + 1;
        for (const [ek, song] of exact) {
            if (ek.length < 7 || Math.abs(ek.length - t.length) > allowed) continue;
            const d = distance(t, ek, allowed);
            if (d < bestD) { best = song; bestD = d; }
        }
        if (best) return { song: best, how: 'fuzzy' };
    }
    return null;
}

// Edit distance, giving up once it exceeds max
function distance(a, b, max) {
    let row = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
        const next = [i];
        let rowMin = i;
        for (let j = 1; j <= b.length; j++) {
            next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
            if (next[j] < rowMin) rowMin = next[j];
        }
        if (rowMin > max) return max + 1;
        row = next;
    }
    return row[b.length];
}

// A whole archive title -> official titles it names (empty means extras)
function songsFor(title) {
    if (NOT_SONGS.some(t => title.toLowerCase().includes(t))) return [];
    const whole = matchOne(title);
    if (whole && whole.how !== 'prefix') return [whole];
    const parts = clean(title).split(/\s*(?:->|-+>|>+|\/|,|;|\+|_|\s-\s|\s~\s|\binto\b)\s*/i).filter(Boolean);
    if (parts.length > 1) {
        const found = [];
        for (const part of parts) {
            const m = matchOne(part);
            if (m && !found.some(f => f.song === m.song)) found.push(m);
        }
        if (found.length) return found;
    }
    return whole ? [whole] : [];
}

// --- Build ---
const raw = JSON.parse(fs.readFileSync('data.js', 'utf8').replace(/^const MASTER_DATA = /, '').replace(/;\s*$/, ''));

const bySong = new Map(); // official title -> Map(showIdx -> archive title)
const extras = [];        // [showIdx, archive title]
const extrasSeen = new Set();
const report = [];

for (const title in raw.songs) {
    const shows = raw.songs[title];
    const found = songsFor(title);
    report.push([title, found.map(f => f.song + (f.how !== 'exact' ? ` (${f.how})` : '')).join(' + ') || EXTRAS, shows.length]);
    if (!found.length) {
        // Rows that would find the same track in the same show are dropped
        for (const idx of shows) {
            const k = idx + '|' + pageNorm(title);
            if (!extrasSeen.has(k)) { extrasSeen.add(k); extras.push([idx, title]); }
        }
        continue;
    }
    for (const { song } of found) {
        if (!bySong.has(song)) bySong.set(song, new Map());
        const perf = bySong.get(song);
        for (const idx of shows) {
            // One row per show. Prefer a title the official name can find in the
            // show's tracks, and among those the shortest (the plainest track).
            const prev = perf.get(idx);
            const findable = t => pageNorm(t).includes(pageNorm(song));
            if (prev === undefined ||
                (findable(title) && !findable(prev)) ||
                (findable(title) === findable(prev) && title.length < prev.length)) {
                perf.set(idx, title);
            }
        }
    }
}

const songs = {};
for (const song of [...bySong.keys()].sort()) {
    const target = pageNorm(song);
    songs[song] = [...bySong.get(song)]
        .sort((a, b) => a[0] - b[0])
        .map(([idx, title]) => pageNorm(title).includes(target) ? idx : [idx, title]);
}
extras.sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1]));
songs[EXTRAS] = extras;

// --- Integrity check: every original (title, show) link is still reachable ---
let missing = 0;
for (const [title, mapped] of report.map(r => [r[0], r[1]])) {
    const names = mapped === EXTRAS ? [EXTRAS] : mapped.split(' + ').map(s => s.replace(/ \((prefix|fuzzy)\)$/, ''));
    for (const idx of raw.songs[title]) {
        const reachable = names.every(n => songs[n].some(p => (typeof p === 'number' ? p : p[0]) === idx));
        if (!reachable) missing++;
    }
}
if (missing) {
    console.error(`CRITICAL: ${missing} show-song links would be dropped. Output not written.`);
    process.exit(1);
}

const output = { shows: raw.shows, songs, extras: EXTRAS };
fs.writeFileSync('data-cleaned-names.js', `const MASTER_DATA_CLEANED = ${JSON.stringify(output)};`);

const extraLinks = extras.length;
let songLinks = 0;
for (const s in songs) if (s !== EXTRAS) songLinks += songs[s].length;
console.log(`Archive titles: ${Object.keys(raw.songs).length}`);
console.log(`Official songs: ${Object.keys(songs).length - 1} (+ "${EXTRAS}")`);
console.log(`Song performances: ${songLinks}, extras tracks: ${extraLinks}`);
console.log('Check passed: every archive title/show is still reachable.');

if (process.argv.includes('--report')) {
    report.sort((a, b) => b[2] - a[2]);
    fs.writeFileSync('song-mapping-report.tsv', 'archive title\tmapped to\tshows\n' + report.map(r => r.join('\t')).join('\n') + '\n');
    console.log('Wrote song-mapping-report.tsv');
}
