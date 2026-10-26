# PairPad

PairPad is a real-time collaborative coding workspace for live pairing, technical interviews, sandboxed execution, and session replay.

Work together in the same editor, see collaborators as they type, run code without executing it on your machine, and review completed sessions afterward.

## Why PairPad

- **Collaborative rooms** — Join a room with a name and room ID, then edit together in real time.
- **Conflict-free synchronization** — Yjs CRDT updates keep concurrent edits mergeable.
- **Live presence** — See collaborators, cursor positions, selections, and names.
- **Sandboxed execution** — Run JavaScript, Python, C++, and Java with stdin support through the backend execution service.
- **Interview mode** — Create private interviewer links, configure a problem and timer, and judge submissions against hidden test cases.
- **Session replay** — Record room activity and replay finished sessions from a shareable room link.
- **Light theme** — A consistent light workspace across the Home, room, interview, and replay flows.
- **Responsive Home experience** — The landing page includes navigation, quick actions, product explanations, and mobile layouts.

## Screens and workflows

### Join or create a room

1. Enter your name.
2. Enter an existing room ID or generate one.
3. Join the room.

The room URL uses the existing format:

```text
/?room=<room-id>&name=<display-name>
```

### Start an interview

1. Enter the interviewer’s name.
2. Create an interview.
3. Share the private candidate link.
4. Configure the problem and timer.
5. Start the interview and review submissions.

The interviewer key and name are stored locally per interview room so the interviewer can reconnect to the session.

### Watch a replay

Enter a completed room ID to open its replay:

```text
/?replay=<room-id>
```

### Interview routes

Interview sessions use the existing query format:

```text
/?interview=<room-id>
```

## Architecture

PairPad is a small full-stack JavaScript application:

```text
PairPad/
├── Backend/
│   ├── index.js        Server bootstrap and Socket.IO room coordination
│   ├── config/         Environment-backed limits and service constants
│   ├── routes/         HTTP API and static frontend routes
│   ├── services/       External execution services such as Wandbox
│   ├── utils/          Shared validation and security helpers
│   └── problems.js     Interview problem definitions and test data
├── Frontend/
│   ├── src/
│   │   ├── App.jsx     Query-parameter router
│   │   ├── Home.jsx    Landing page and existing Home workflows
│   │   ├── Room.jsx    Collaborative room UI
│   │   ├── Interview.jsx
│   │   ├── Replay.jsx
│   │   ├── socket.js   Shared Socket.IO client
│   │   ├── yjsProvider.js
│   │   ├── components/
│   │   ├── hooks/
│   │   └── styles/
│   ├── vite.config.js  Vite development server and backend proxy
│   └── package.json
├── package.json
└── README.md
```

### Frontend

- React 19
- Vite
- Monaco Editor
- Yjs and y-monaco
- Socket.IO client
- CSS custom properties for the light design system and editor themes

### Backend

- Node.js with Express
- Socket.IO for room collaboration and interview events
- Yjs document synchronization and awareness updates
- In-memory active rooms and finished recordings
- Modular Axios integration with Wandbox for code execution and judging

The current server keeps active room state and finished recordings in memory. Restarting the backend clears that in-memory state.

## Important server events

The frontend and backend communicate through the existing Socket.IO protocol. Main event families include:

- Normal rooms: `join`, `leave-room`, `yjs-update`, `awareness-update`, `languageChange`, `compileCode`
- Interviews: `create-interview`, `join-interview`, `interview-configure`, `interview-start`, `interview-end`, `interview-submit`
- Connection and state updates: `connect`, `disconnect`, `yjs-init`, `interview-state`, `codeResponse`

These event names and payload contracts are part of the application behavior and should not be changed casually.

## Requirements

- Node.js 20 or newer is recommended.
- npm
- Network access for:
  - Wandbox code execution and judging
  - Google Fonts in the default development HTML

## Installation

Clone the repository and install both workspaces:

```bash
git clone <your-repository-url>
cd Collaborate-code
npm install
cd Frontend
npm install
cd ..
```

## Environment variables

Copy the example file:

```bash
cp Frontend/.env.example Frontend/.env
```

Available frontend variables:

| Variable | Purpose | Default |
| --- | --- | --- |
| `VITE_SOCKET_URL` | Socket.IO backend URL when the frontend is hosted separately | Empty; Vite proxy is used locally |
| `VITE_GITHUB_URL` | GitHub link shown in the Home footer and navbar | `https://github.com/vivekcode12345` |

Backend variables:

| Variable | Purpose | Default |
| --- | --- | --- |
| `PORT` | HTTP and Socket.IO server port | `5000` |
| `ALLOWED_ORIGIN` | Socket.IO CORS origin | `*` |
| `REPLAY_MAX_EVENTS` | Maximum replay events retained per recording | `20000` |
| `REPLAY_RATE_MAX` | Replay API requests allowed per rate-limit window | `20` |
| `REPLAY_RATE_WINDOW_MS` | Replay API rate-limit window | `60000` |
| `INTERVIEW_MAX_SUBMISSIONS` | Maximum submissions per interview | `5` |

Additional interview limits are defined in `Backend/index.js` and use safe defaults when not configured.

## Development

Start the backend from the repository root:

```bash
npm start
```

Start the Vite frontend in a second terminal:

```bash
cd Frontend
npm run dev
```

Open:

```text
http://localhost:5173
```

During development, Vite proxies `/socket.io` and `/api` requests to `http://localhost:5000`.

For automatic backend restarts:

```bash
npm run dev
```

## Production build

Build the frontend:

```bash
cd Frontend
npm run build
```

Or use the root build command:

```bash
npm run build
```

The root build installs dependencies, builds the frontend, and produces the Vite output in `Frontend/dist`.

The backend serves the built frontend and provides SPA fallback handling for the query-parameter routes.

## Validation

Run the available frontend checks:

```bash
cd Frontend
npm run lint
npm run build
```

Backend syntax can be checked with:

```bash
node --check Backend/index.js
```

There is currently no automated test suite configured in the repository. Manual smoke testing should cover:

1. Home page at desktop and mobile widths.
2. Room ID generation and room joining.
3. Two browser windows editing the same room.
4. Code execution for each supported language.
5. Interview creation, candidate joining, submission, and report access.
6. Replay creation and playback.
7. Light-theme rendering across all application flows.

## API endpoints

The frontend uses these HTTP endpoints for post-session data:

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/replay/:roomId` | Fetch a finished room recording |
| `GET` | `/api/interview/:roomId/report` | Fetch a finished interview report |

Real-time room and interview operations use Socket.IO rather than REST endpoints.

## Security and resource limits

PairPad includes server-side safeguards for the existing workflows:

- Code and binary update payload limits.
- Replay event and recording-size limits.
- Replay and report rate limiting.
- Interview submission limits and cooldowns.
- Hidden interview tests remain server-side.
- Input and output are bounded before being returned to clients.

Code execution depends on the public Wandbox service. Its availability and startup capacity can affect execution and judging results; infrastructure failures are handled separately from ordinary compile or answer failures.

## Design system

The frontend uses shared CSS tokens for:

- Warm gold accents
- Light and dark surfaces
- Text and muted-text contrast
- Border radii and spacing
- Control heights
- Shadows
- Syntax highlighting

Home-only presentation is split across reusable components such as the navbar, command palette, hero preview, feature sections, how-it-works section, and CTA band. Existing Room, Interview, and Replay functionality continues to use the shared application components and legacy styles where required.

## Contributing

When making changes:

1. Preserve Socket.IO event names and payloads.
2. Preserve room, interview, and replay URL formats.
3. Do not expose hidden tests or interviewer-only data to candidates.
4. Keep changes scoped to the relevant screen or subsystem.
5. Run lint, build, and the relevant manual workflow checks.
6. Do not commit secrets or local `.env` files.

## License

This repository does not currently declare a project-specific open-source license. Add an explicit license before publishing PairPad for external redistribution.
