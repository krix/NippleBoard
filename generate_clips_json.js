#!/usr/bin/env node
/**
 * Scannt den Ordner clips/ und erzeugt/aktualisiert clips.json.
 * Vorhandene Titel, IDs und Bilder bleiben erhalten.
 */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const CLIPS_DIR = path.join(ROOT, 'clips');
const OUT_FILE = path.join(ROOT, 'clips.json');
const EXTS = new Set(['.mp4', '.webm', '.mov']);

function makeId(name) {
  const base = path.parse(name).name.toLowerCase();
  const id = base.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return id || 'clip';
}

function titleize(name) {
  const base = path.parse(name).name;
  return base.replace(/_/g, ' ').replace(/-/g, ' ').trim() || base;
}

function main() {
  let existing = [];
  if (fs.existsSync(OUT_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8'));
      if (Array.isArray(data)) existing = data;
    } catch (e) {
      console.warn('Warnung: clips.json konnte nicht gelesen werden:', e.message);
    }
  }

  const byFile = new Map();
  const byId = new Map();
  for (const entry of existing) {
    if (entry && typeof entry === 'object') {
      if (entry.file) byFile.set(entry.file, entry);
      if (entry.id) byId.set(entry.id, entry);
    }
  }

  let files = [];
  if (fs.existsSync(CLIPS_DIR)) {
    files = fs.readdirSync(CLIPS_DIR).filter(f => EXTS.has(path.extname(f).toLowerCase()));
  }
  files.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

  const result = [];
  const usedIds = new Set();
  for (const f of files) {
    const rel = 'clips/' + f;
    const prev = byFile.get(rel);
    let entry;
    if (prev) {
      entry = {
        id: prev.id || makeId(f),
        file: rel,
        title: prev.title || titleize(f),
        image: Object.prototype.hasOwnProperty.call(prev, 'image') ? prev.image : null,
      };
    } else {
      const baseId = makeId(f);
      let cid = baseId;
      let n = 2;
      while (usedIds.has(cid) || (byId.has(cid) && byId.get(cid).file !== rel)) {
        cid = `${baseId}-${n}`;
        n++;
      }
      entry = { id: cid, file: rel, title: titleize(f), image: null };
    }
    usedIds.add(entry.id);
    result.push(entry);
  }

  fs.writeFileSync(OUT_FILE, JSON.stringify(result, null, 2) + '\n', 'utf8');
  console.log(`${result.length} Clips in ${OUT_FILE} geschrieben.`);
}

main();
