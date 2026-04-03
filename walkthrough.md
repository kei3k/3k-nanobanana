# Walkthrough: Visual Layer Mode

Successfully integrated the Visual Layer Mode onto the existing FreeFire Character Tool.

## What was implemented
1. **Visual Workspace UI**
   - Added Mặc Đồ (Visual) mode tab which loads by default.
   - Left Sidebar with Category navigation (Head, Face, Top, Bottom, Footwear) and thumbnail grid.
   - Right Sidebar with dynamic Layer Stack mirroring Photoshop layers. Includes Eye Icons to toggle item visibility.
   - Center Mannequin Canvas with Drap-and-Drop capability.

2. **Node Graph Synchronization logic**
   - Interfaced isual-mode.js seamlessly with pp.nodeEditor.graph.
   - On workspace init, a custom static graph is constructed in the background (ImageInput -> ComponentSelector -> Output).
   - Dragging an item updates the backend ComponentSelectorNode slots with real Base64 image references and automatically triggers pp.nodeEditor.executeWorkflow() with a debounce.

3. **Convert Custom Assets Logic**
   - Implemented a + Custom button to upload external images.
   - Calls the new POST /api/assets/convert which leverages gemini.editImage and FF_STYLE_CONSISTENCY_PROMPT to isolate the item onto a clean background.
   - Assets are seamlessly inserted into the Database using existing logic and immediately reflected in the sidebar.

## Verification
- Modes toggle smoothly.
- DB components fetch and populate lists.
- Drag & Drop sets component configurations, effectively running "Text-to-Image / Edit-to-Image" generation with the underlying LiteGraph node configs.
