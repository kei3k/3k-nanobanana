# 🍌 3K Nanobana — Professional AI Image Editor

**Professional internal tool for Media Teams** — Chat-based, stateful AI image editor powered by Google Gemini Nano Banana Pro & Nano Banana 2.

![Nanobana UI](docs/screenshot.png)

## ✨ Features

### Chat-Based Editing
- Upload an image → Chat to edit (V1, V2, V3...)
- Full conversation context preserved per session
- Branch from any version to explore alternatives

### AI Models
| Model | ID | Best For |
|-------|---|----------|
| **Nano Banana Pro** | `gemini-3-pro-image-preview` | Professional quality, complex edits |
| **Nano Banana 2** | `gemini-3.1-flash-image-preview` | Speed, high-volume |

### Advanced Editing
- 🔒 **Identity Lock** — Preserve facial features during edits
- 🧵 **Texture Preservation** — Maintain material/fabric details
- ⬆️ **4K Upscaling** — One-click resolution upgrade
- 🖌️ **Canvas Masking** — Paint regions for targeted edits
- 🎛️ **Denoising / Seed** — Control edit intensity and style
- 🧠 **Thinking Level** — Minimal (fast) or High (quality)

### Batch Processing
- Upload 10-100 images at once
- Async queue with configurable concurrency
- Real-time progress via Server-Sent Events
- Export as PNG/TIFF/JPEG/WebP

## 🚀 Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Set your Gemini API key
#    Edit .env and replace YOUR_API_KEY_HERE
#    Get a key at: https://aistudio.google.com/apikey

# 3. Start the server
npm run dev

# 4. Open browser
#    http://localhost:3000
```

## 📁 Project Structure

```
├── server.js                 # Express entry point
├── src/
│   ├── api/
│   │   ├── routes.js         # REST API endpoints
│   │   └── sse.js            # Server-Sent Events
│   ├── services/
│   │   ├── gemini.js         # Gemini API wrapper
│   │   ├── queue.js          # Async queue manager
│   │   ├── session.js        # Session/version management
│   │   ├── prompt-engine.js  # Prompt engineering
│   │   └── image-processor.js # Image utilities (Sharp)
│   └── db/
│       ├── schema.sql        # SQLite schema
│       └── database.js       # Database helpers
├── public/
│   ├── index.html            # SPA shell
│   ├── css/                  # Design system + components
│   └── js/                   # Frontend controllers
└── data/                     # Auto-created: images + SQLite DB
```

## ⚙️ Configuration (.env)

| Variable | Default | Description |
|----------|---------|-------------|
| `GEMINI_API_KEY` | — | Your Gemini API key (required) |
| `PORT` | `3000` | Server port |
| `QUEUE_CONCURRENCY` | `3` | Max parallel AI jobs |
| `MAX_RETRIES` | `2` | Retry failed jobs |
| `DEFAULT_MODEL` | `pro` | Default model (`pro` or `flash`) |

## 📡 API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/sessions` | Create session |
| `GET` | `/api/sessions` | List sessions |
| `POST` | `/api/sessions/:id/upload` | Upload image |
| `POST` | `/api/sessions/:id/chat` | Send edit prompt |
| `POST` | `/api/sessions/:id/upscale/:vId` | Upscale to 4K |
| `POST` | `/api/batch` | Batch processing |
| `GET` | `/api/queue/stream` | SSE progress |
| `GET` | `/api/queue/stats` | Queue statistics |

---

Built with ❤️ by 3K Media Team
