# Finds and reads files inside the game's archives, by path or by id.
import os, re, struct

class Rez:
    def __init__(self, game):
        self.game = game
        self.ltb = open(os.path.join(game, 'rezmap.ltb'), 'rb').read()
        self.by_id, self.by_path, self.packs = {}, {}, {}
        line = re.compile(r'^([0-9A-Fa-f]{8}) ([0-9A-Fa-f]{8}) "([^"]+)" packed "([^"]+)"')
        for text in open(os.path.join(game, 'rezmap.lta'), encoding='latin-1'):
            m = line.match(text)
            if not m:
                continue
            entry = (int(m.group(1), 16), int.from_bytes(bytes.fromhex(m.group(2)), 'little'), m.group(3), m.group(4))
            self.by_id[entry[0]] = entry
            self.by_path[entry[2].lower()] = entry
        # Many ids are only another name for a file listed above ("alias" lines). They read the same file.
        alias = re.compile(r'^([0-9A-Fa-f]{8}) [0-9A-Fa-f]{8} alias ([0-9A-Fa-f]{8})')
        links = {}
        for text in open(os.path.join(game, 'rezmap.lta'), encoding='latin-1'):
            m = alias.match(text)
            if m:
                links[int(m.group(1), 16)] = int(m.group(2), 16)
        for rid, target in links.items():
            for _ in range(8):
                if target in self.by_id or target not in links:
                    break
                target = links[target]
            if target in self.by_id:
                self.by_id[rid] = self.by_id[target]

    def name(self, rid):
        return self.by_id[rid][2].split('/')[-1] if rid in self.by_id else None

    def read(self, key):
        rid, kind, path, pack = self.by_id[key] if isinstance(key, int) else self.by_path[key.lower()]
        size_of_pack = os.path.getsize(os.path.join(self.game, pack))
        needle = struct.pack('<I', rid)
        at = self.ltb.find(needle)
        while at >= 0:
            if at + 56 <= len(self.ltb):
                flags, off, size = struct.unpack_from('<III', self.ltb, at + 44)
                if flags == kind and 0 < size and off + size <= size_of_pack:
                    with open(os.path.join(self.game, pack), 'rb') as f:
                        f.seek(off)
                        return f.read(size)
            at = self.ltb.find(needle, at + 1)
        raise KeyError(f'no record for {path}')
