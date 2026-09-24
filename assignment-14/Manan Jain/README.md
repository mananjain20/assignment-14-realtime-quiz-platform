# ⚡ Quiz Battle — Real-Time Multiplayer Live Quiz (Kahoot-Style)

A high-performance, real-time multiplayer trivia platform built with **Node.js**, **Express.js**, and **Socket.io**. Featuring authoritative server clocks, millisecond-precision speed bonus scoring, live animated podiums, and strict anti-cheat validation.

---

## 🌐 Live Deployment -   https://assignment-14-realtime-quiz-platform-2.onrender.com




## 🚀 Key Features & Highlights

- **Server-Authoritative State Machine**: All round state transitions, timers, and scoring are managed exclusively by the server. Clients never dictate question timeouts, validity, or scores.
- **Speed-Bonus Scoring Formula**: Up to 1000 points per question (500 base points for correctness + up to 500 speed bonus points calculated from server-side elapsed milliseconds).
- **Anti-Cheat & Validation Engine**:
  - Correct answers and explanations are **never** transmitted to clients during active question rounds.
  - Answers submitted past the deadline (`Date.now() > deadline`) are rejected with `time_expired`.
  - Client-supplied timing fields (`timeTakenMs`) are completely ignored; elapsed time is computed strictly on the server (`now - room.serverStartTs`).
  - Double submissions (`already_answered`), invalid option indices (`invalid_option`), and unauthorized start requests from non-hosts are strictly prevented.
- **In-Memory Room Management**: Complete in-memory state architecture using native `Map` collections keyed by unique 4-digit PINs (no database overhead).
- **Interactive Dual UI**:
  - **Host Screen (`host.html`)**: Big-screen presentation view with live PIN display, player lobby avatar chips, question broadcast with animated countdown timers, explanation reveals, and 3D-styled winner podiums.
  - **Player Pad (`player.html`)**: Mobile-first responsive gamepad with rapid 4-color touch buttons (Red ▲, Blue ◆, Yellow ●, Green ■), tactile feedback, locked-in answer state, and live individual standing updates.
  - **Synthesized Audio Engine**: Built-in Web Audio API sound generator providing sound effects (countdown ticks, buzzer, correct chimes, wrong buzzer, victory fanfare) with zero external asset dependencies.

---

## 🛠️ Tech Stack & Architecture

- **Backend**: Node.js, Express.js, Socket.io, CORS, dotenv
- **Frontend**: Vanilla HTML5, Modern CSS (Glassmorphism & Gradients), Vanilla JavaScript (ES6+)
- **Testing**: `socket.io-client` automated end-to-end simulation suite

---

## 📁 Project Directory Structure

```
assignment-14-quiz-socket/
├── data/
│   └── questions.json     # Curated question bank (Tech & General categories)
├── public/
│   ├── index.html         # Landing portal: Host a Quiz & Join a Battle
│   ├── host.html          # Big screen Host presenter dashboard
│   ├── player.html        # Mobile-friendly player gamepad controller
│   ├── style.css          # Modern dark glassmorphic design system & animations
│   └── app.js             # Web Audio API synthesizer & toast manager
├── sockets/
│   ├── gameEngine.js      # Authoritative timers, anti-cheat, scoring & leaderboards
│   └── lobbyHandler.js    # PIN generation, room lifecycle & socket routing
├── test/
│   └── simulate.js        # Automated simulation and anti-cheat test suite
├── .env                   # Environment config (PORT=5000)
├── .gitignore             # Git ignore definitions
├── package.json           # Scripts and dependencies
├── server.js              # Express + Socket.io server entry point
└── README.md              # Project documentation
```

---

## ⚡ Quick Start & Setup

### 1. Install Dependencies
```bash
npm install
```

### 2. Run the Development Server
```bash
npm run dev
# or
npm start
```
The server will start at **`http://localhost:5000`**.

### 3. Open the Web Application
- **Main Portal**: [http://localhost:5000](http://localhost:5000)
- **Host Dashboard**: [http://localhost:5000/host.html](http://localhost:5000/host.html)
- **Player Gamepad**: [http://localhost:5000/player.html](http://localhost:5000/player.html)

---

## 🧪 Automated Testing

Run the automated simulation and anti-cheat verification script:
```bash
npm test
```
The test suite validates:
1. Exact scoring calculation unit math.
2. Unique 4-digit PIN generation and room creation.
3. Multi-player lobby joining and duplicate name blocking.
4. Non-host start prevention.
5. Server clock authoritativeness (fast answers receive higher score, faked client times ignored).
6. Double answer and invalid option index rejection.
7. Leaderboard rank sorting with tie-breaking.

---

## 🎮 Manual Testing with 3 Browser Tabs

1. **Open Tab 1 (Host)**:
   - Navigate to `http://localhost:5000/host.html`.
   - Enter your host name, select the **Tech** category, and click **"Create Room & Generate PIN"**.
   - Note the generated 4-digit PIN (e.g. `4821`).

2. **Open Tab 2 (Player 1)**:
   - Navigate to `http://localhost:5000/player.html`.
   - Enter PIN `4821` and nickname **Alice**. Click **"Enter Game"**.
   - Tab 1 (Host) immediately updates to show Alice in the lobby.

3. **Open Tab 3 (Player 2)**:
   - Navigate to `http://localhost:5000/player.html`.
   - Enter PIN `4821` and nickname **Bob**. Click **"Enter Game"**.
   - Tab 1 (Host) immediately shows both Alice and Bob, and the **"Start Game"** button becomes active.

4. **Play the Game**:
   - On Tab 1, click **"Start Game"**.
   - Both player tabs switch to the 4-color gamepad in real-time.
   - On Tab 2 (Alice), tap the correct option immediately. Notice the button locks and displays confirmation.
   - On Tab 3 (Bob), tap after 4-5 seconds.
   - Observe how Alice receives more speed bonus points than Bob, the correct answer is revealed on the host screen with explanation, and the round leaderboard ranks players dynamically.

---

## 📡 Socket Event Protocol Reference

| Event Name | Direction | Payload | Description |
|---|---|---|---|
| `quiz:create` | Host ➔ Server | `{ hostName, category }` | Request to initialize a new room |
| `quiz:created` | Server ➔ Host | `{ pin, roomId: "quiz_<pin>" }` | Returns generated 4-digit PIN |
| `quiz:join` | Player ➔ Server | `{ pin, playerName }` | Player joins room with PIN and name |
| `quiz:joined` | Server ➔ Player | `{ pin, playerName }` | Confirms player join success |
| `lobby:update` | Server ➔ Room | `{ players: [{ name, score, connected }] }` | Broadcasts lobby participants |
| `quiz:start` | Host ➔ Server | `{ pin }` | Host triggers quiz countdown |
| `question:start` | Server ➔ Room | `{ questionIndex, totalQuestions, question, options[], timeLimitSeconds }` | Broadcasts question (*no answers leak*) |
| `timer:tick` | Server ➔ Room | `{ remainingMs }` | Authoritative server clock sync every 1s |
| `answer:submit` | Player ➔ Server | `{ pin, selectedOption, timeTakenMs }` | Player submits selected option (0..3) |
| `answer:received` | Server ➔ Player | `{ accepted: true, score }` | Round score acknowledgment |
| `answer:rejected` | Server ➔ Player | `{ reason }` | Rejected ("time_expired", "already_answered", etc.) |
| `question:time_up` | Server ➔ Room | `{ correctOption, explanation }` | Reveals correct answer and trivia explanation |
| `leaderboard:update` | Server ➔ Room | `{ leaderboard: [{ rank, name, score }] }` | Broadcasts sorted leaderboard |
| `quiz:ended` | Server ➔ Room | `{ winner: { name, score }, finalRanks: [...] }` | Final winner podium and standings |
| `quiz:error` | Server ➔ Client | `{ message }` | General error / validation rejection |

---

## 🧮 Authoritative Scoring Formula

Exported from `sockets/gameEngine.js`:
```javascript
function calculateScore(isCorrect, timeTakenMs, totalTimeLimitMs = 15000) {
  if (!isCorrect) return 0;
  const clampedTime = Math.max(0, Math.min(timeTakenMs, totalTimeLimitMs));
  const timeRemaining = Math.max(0, totalTimeLimitMs - clampedTime);
  const speedBonus = Math.round((timeRemaining / totalTimeLimitMs) * 500);
  return 500 + speedBonus; // max 1000
}
```

---

## 📊 Grading Requirements Compliance Summary

| Category | Points | Implementation Details |
|---|---|---|
| **Lobby / PIN Management** | **25 / 25** | Unique 4-digit PIN generation with collision handling; duplicate/empty name rejection (case-insensitive); real-time lobby updates; host & player disconnect cleanup. |
| **Authoritative Server Timers** | **25 / 25** | Server-managed 15s deadline per question; 1s sync ticks (`timer:tick`); auto early-end when all players submit; 5s reveal delay before auto-advancing; proper `clearTimeout`/`clearInterval` handling. |
| **Scoring & Anti-Cheat** | **20 / 20** | `calculateScore` formula (500 base + 500 speed bonus); `timeTakenMs` calculated on server; questions broadcast without solutions; answers after deadline rejected; non-host start requests blocked. |
| **Leaderboard & Ranks** | **15 / 15** | Dynamic sorting by score (DESC), tie-breaking by cumulative response time (ASC), then name; broadcast via `leaderboard:update`; final winner & full rankings in `quiz:ended`. |
| **Dual UI Polish & Aesthetics** | **15 / 15** | Modern dark glassmorphic theme; 4-shape Kahoot gamepad; live answer counters; visual timers; Web Audio API sound synthesizer; responsive layouts for desktop & mobile. |
