# Visual Layer Mode Integration

This plan implements a "Simple Visual Layer Mode" (Visual Closet) alongside the existing Node Editor, syncing transparently with the backend Node graph, and adding Asset Generation.

## Proposed Changes

### UI & Frontend Core Layer
- We will add a new isual mode alongside 
odes and chat.
- The index.html structure will be updated to include the Visual Closet workspace:
  - **Left Sidebar**: Asset categories (Hair/Head, Face, Top, Bottom, Shoes). When a category is active, it shows a scrollable thumbnail grid of available assets.
  - **Center Canvas**: The main large preview of the 3D character (Pose Model).
  - **Right Sidebar (Layer Stack)**: A Photoshop-style layer list matching the active slots. Each slot (layer) will have a visibility Eye Icon (👁️) and a small preview of the applied asset.
- **Drag & Drop**: Users can drag a thumbnail from the left sidebar and drop it onto the center canvas (or the right layer stack) to equip it.

### Node Editor Sync Logic
- public/js/app.js and a new public/js/visual-mode.js will handle the bridging.
- When an asset is dropped, the visual manager will find or create a ComponentSelector node inside the LiteGraph instance (pp.nodeEditor.graph), configure the specific slot (e.g., 	op) with the asset image.
- **Layer Visibility**: Toggling the eye icon will momentarily "disable" that slot in the ComponentSelector config. 
- A debounced (e.g., 800ms) "Execute Workflow" call will trigger pp.nodeEditor.executeWorkflow() dynamically in the background to update the Center Canvas preview to the new character.

### Asset Generation API
- A new route /api/assets/convert will be added to server.js (or outes.js).
- Uploading a reference image will trigger a Gemini edit call using FF_STYLE_CONSISTENCY_PROMPT to refine it into a FreeFire 3D game-style standalone item.
- Extracted items will be saved under data/assets/{category}/{timestamp}.png and registered so they appear in the Left Sidebar's grid.
- We will also add a GET /api/assets route to fetch the categorized asset lists.

## Open Questions

1. Should the Visual Mode fully replace the current Chat Mode as the default experience, or be a 3rd distinct mode (Chat / Visual / Nodes)?
2. For the initial state of the Visual Closet, do you want a default base character generated automatically when the session starts, or will the user still upload an initial base character as in Chat mode?
3. Does the system need to track the coordinate position of dropped items on the character, or is mapping handled strictly by the Gemini prompt using keywords and reference images per slot?

## Verification Plan

### Automated Tests
- Test API routes GET /api/assets and POST /api/assets/convert using curl or browser inspector.
- Verify data/assets/ directory generation and file saves.

### Manual Verification
- Open UI, drag an asset from Left Sidebar.
- Verify that LiteGraph nodes updated successfully and execution triggers in the background.
- Toggle Eye icon on Right Sidebar and check if the change registers properly.
- Upload an image, click "Convert to Asset", ensure it applies the style and lands in the grid.
