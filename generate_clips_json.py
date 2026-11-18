#!/usr/bin/env python3
"""Scannt den Ordner clips/ und erzeugt/aktualisiert clips.json.
Vorhandene Titel, IDs und Bilder bleiben erhalten."""
import json
import os
import re

ROOT = os.path.dirname(os.path.abspath(__file__))
CLIPS_DIR = os.path.join(ROOT, 'clips')
OUT_FILE = os.path.join(ROOT, 'clips.json')
EXTS = ('.mp4', '.webm', '.mov')


def make_id(name):
    base = os.path.splitext(name)[0].lower()
    base = re.sub(r'[^a-z0-9]+', '-', base).strip('-')
    return base or 'clip'


def titleize(name):
    base = os.path.splitext(name)[0]
    return base.replace('_', ' ').replace('-', ' ').strip() or base


def main():
    existing = []
    if os.path.exists(OUT_FILE):
        try:
            with open(OUT_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
            if isinstance(data, list):
                existing = data
        except Exception as e:
            print(f'Warnung: clips.json konnte nicht gelesen werden: {e}')

    by_file = {}
    by_id = {}
    for entry in existing:
        if isinstance(entry, dict):
            if entry.get('file'):
                by_file[entry['file']] = entry
            if entry.get('id'):
                by_id[entry['id']] = entry

    files = []
    if os.path.isdir(CLIPS_DIR):
        for f in os.listdir(CLIPS_DIR):
            if f.lower().endswith(EXTS):
                files.append(f)
    files.sort(key=str.lower)

    result = []
    used_ids = set()
    for f in files:
        rel = 'clips/' + f
        prev = by_file.get(rel)
        if prev:
            entry = {
                'id': prev.get('id') or make_id(f),
                'file': rel,
                'title': prev.get('title') or titleize(f),
                'image': prev.get('image', None),
            }
        else:
            base_id = make_id(f)
            cid = base_id
            n = 2
            while cid in used_ids or (cid in by_id and by_id[cid].get('file') != rel):
                cid = f"{base_id}-{n}"
                n += 1
            entry = {'id': cid, 'file': rel, 'title': titleize(f), 'image': None}
        used_ids.add(entry['id'])
        result.append(entry)

    with open(OUT_FILE, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
        f.write('\n')

    print(f'{len(result)} Clips in {OUT_FILE} geschrieben.')


if __name__ == '__main__':
    main()
