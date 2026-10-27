-- What a visitor sticker is stuck to. The canvas lays the notes out anew on
-- every load (most recently updated topic in the middle), so a new note moves
-- whole piles and a sticker kept only by world x/y ends up next to another
-- note. `anchor` is the closest thing when it was placed: 'intro', 'friends'
-- or 'card:<slug>'; anchor_x / anchor_y are that thing's top-left corner in
-- world px at that moment. The canvas shows the sticker at
-- x/y + (where the anchor is now - anchor_x/anchor_y); without an anchor (or
-- when the note is gone) at plain x/y. See src/scripts/interact/sticker-anchor.ts.
ALTER TABLE stickers ADD COLUMN anchor TEXT;
ALTER TABLE stickers ADD COLUMN anchor_x REAL;
ALTER TABLE stickers ADD COLUMN anchor_y REAL;
