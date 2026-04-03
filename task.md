# Task List: Visual Layer Mode

- [x] 1. Asset & Backend APIs
  - [x] Create data/assets folders (head, face, top, bottom, footwear) -- handled by db components
  - [x] Create GET /api/assets/:category -- reused /api/components?slot=
  - [x] Create POST /api/assets/convert using FF_STYLE_CONSISTENCY_PROMPT
- [x] 2. UI Elements (index.html & public/css/visual-mode.css)
  - [x] Add isual tab to mode switcher
  - [x] Left Sidebar: Categories & Thumbnail Grid
  - [x] Center: Character Preview Canvas (Mannequin placeholder)
  - [x] Right Sidebar: Layer Stack
- [x] 3. Frontend Logic (public/js/app.js & public/js/visual-mode.js)
  - [x] Route visual mode correctly on startup
  - [x] Handle drag & drop of assets
  - [x] Sync dropped items to ComponentSelector node in LiteGraph
  - [x] Implement Layer Stack eyeball toggle & auto re-rendering
- [ ] 4. Verification
  - [ ] Test converting an item, equipping it, and observing re-render
