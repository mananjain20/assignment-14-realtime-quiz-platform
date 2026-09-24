/**
 * lobbyHandler.js
 * Room creation, 4-digit PIN generation, player joining/leaving, socket routing, and lifecycle management.
 */

const fs = require('fs');
const path = require('path');
const gameEngine = require('./gameEngine');

// In-memory rooms store: Map<pin, Room>
const rooms = new Map();

// Socket to Room mapping for fast lookup on disconnect: Map<socketId, { pin, isHost, playerName }>
const socketMeta = new Map();

// Load questions bank
let questionsBank = [];
try {
  const data = fs.readFileSync(path.join(__dirname, '../data/questions.json'), 'utf8');
  questionsBank = JSON.parse(data);
} catch (err) {
  console.error('[lobbyHandler] Failed to load questions.json:', err);
}

/**
 * Generate a unique 4-digit PIN (1000-9999)
 */
function generatePin() {
  let pin;
  let attempts = 0;
  do {
    pin = Math.floor(1000 + Math.random() * 9000).toString();
    attempts++;
    if (attempts > 10000) {
      throw new Error('Unable to generate unique PIN');
    }
  } while (rooms.has(pin));
  return pin;
}

/**
 * Shuffles an array (Fisher-Yates)
 */
function shuffleArray(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Select questions for a room based on category (5 questions)
 */
function selectQuestions(category = 'All', count = 5) {
  let pool = questionsBank;
  if (category && category !== 'All') {
    const filtered = questionsBank.filter(q => q.category.toLowerCase() === category.toLowerCase());
    if (filtered.length > 0) {
      pool = filtered;
    }
  }
  const shuffled = shuffleArray(pool);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

/**
 * Register all socket events
 * @param {Object} io Socket.io server instance
 */
function registerSocketHandlers(io) {
  io.on('connection', (socket) => {
    // -------------------------------------------------------------
    // 1. Host creates a quiz room
    // -------------------------------------------------------------
    socket.on('quiz:create', (payload) => {
      try {
        const { hostName = 'Host', category = 'Tech' } = payload || {};
        const pin = generatePin();
        const roomId = `quiz_${pin}`;
        const selectedQs = selectQuestions(category, 5);

        const room = {
          pin,
          roomId,
          hostSocketId: socket.id,
          hostName: (typeof hostName === 'string' && hostName.trim()) ? hostName.trim() : 'Host',
          category,
          status: 'LOBBY', // LOBBY -> QUESTION_ACTIVE -> REVEAL -> ENDED
          players: [],     // [{ socketId, name, score, totalResponseTimeMs, connected, currentAnswer }]
          questions: selectedQs,
          currentQuestionIndex: 0,
          serverStartTs: null,
          deadline: null,
          timerInterval: null,
          questionTimeout: null,
          nextRoundTimeout: null,
          cleanupTimeout: null
        };

        rooms.set(pin, room);
        socket.join(roomId);
        socketMeta.set(socket.id, { pin, isHost: true });

        socket.emit('quiz:created', {
          pin,
          roomId
        });

        console.log(`[lobbyHandler] Room created: PIN=${pin}, Host=${room.hostName}, Category=${category}, Questions=${room.questions.length}`);
      } catch (err) {
        console.error('[lobbyHandler] Error in quiz:create:', err);
        socket.emit('quiz:error', { message: 'Failed to create quiz room.' });
      }
    });

    // -------------------------------------------------------------
    // 2. Player joins a quiz room
    // -------------------------------------------------------------
    socket.on('quiz:join', (payload) => {
      try {
        const { pin, playerName } = payload || {};
        const cleanPin = pin ? pin.toString().trim() : '';
        const cleanName = playerName ? playerName.toString().trim() : '';

        if (!cleanPin || !rooms.has(cleanPin)) {
          socket.emit('quiz:error', { message: 'Invalid or non-existent Game PIN.' });
          return;
        }

        const room = rooms.get(cleanPin);

        if (room.status !== 'LOBBY') {
          socket.emit('quiz:error', { message: 'Game has already started or ended.' });
          return;
        }

        if (!cleanName) {
          socket.emit('quiz:error', { message: 'Player name cannot be empty.' });
          return;
        }

        // Check for duplicate player name (case-insensitive)
        const nameExists = room.players.some(
          p => p.name.toLowerCase() === cleanName.toLowerCase() && p.connected
        );
        if (nameExists) {
          socket.emit('quiz:error', { message: `The name "${cleanName}" is already taken in this room.` });
          return;
        }

        // Add player to room
        const player = {
          socketId: socket.id,
          name: cleanName,
          score: 0,
          totalResponseTimeMs: 0,
          connected: true,
          currentAnswer: null
        };

        room.players.push(player);
        socket.join(room.roomId);
        socketMeta.set(socket.id, { pin: cleanPin, isHost: false, playerName: cleanName });

        // Confirm join to player
        socket.emit('quiz:joined', {
          pin: cleanPin,
          playerName: cleanName
        });

        // Broadcast updated lobby list to entire room (including host)
        io.to(room.roomId).emit('lobby:update', {
          players: room.players.map(p => ({
            name: p.name,
            score: p.score,
            connected: p.connected
          }))
        });

        console.log(`[lobbyHandler] Player "${cleanName}" joined room ${cleanPin} (Total: ${room.players.length})`);
      } catch (err) {
        console.error('[lobbyHandler] Error in quiz:join:', err);
        socket.emit('quiz:error', { message: 'Failed to join quiz.' });
      }
    });

    // -------------------------------------------------------------
    // 3. Host starts the quiz
    // -------------------------------------------------------------
    socket.on('quiz:start', (payload) => {
      try {
        const { pin } = payload || {};
        const cleanPin = pin ? pin.toString().trim() : '';
        const room = rooms.get(cleanPin);

        if (!room) {
          socket.emit('quiz:error', { message: 'Room not found.' });
          return;
        }

        // Validate that only the room host can start
        if (room.hostSocketId !== socket.id) {
          socket.emit('quiz:error', { message: 'Only the host can start the quiz.' });
          return;
        }

        if (room.status !== 'LOBBY') {
          socket.emit('quiz:error', { message: 'Quiz has already started.' });
          return;
        }

        const activePlayers = room.players.filter(p => p.connected);
        if (activePlayers.length < 1) {
          socket.emit('quiz:error', { message: 'Need at least 1 player to start the quiz.' });
          return;
        }

        console.log(`[lobbyHandler] Starting quiz in room ${cleanPin} with ${activePlayers.length} players`);
        gameEngine.startQuiz(io, room);
      } catch (err) {
        console.error('[lobbyHandler] Error in quiz:start:', err);
        socket.emit('quiz:error', { message: 'Failed to start quiz.' });
      }
    });

    // -------------------------------------------------------------
    // 4. Player submits an answer
    // -------------------------------------------------------------
    socket.on('answer:submit', (payload) => {
      try {
        const { pin } = payload || {};
        const cleanPin = pin ? pin.toString().trim() : '';
        const room = rooms.get(cleanPin);

        if (!room) {
          socket.emit('answer:rejected', { reason: 'room_not_found' });
          return;
        }

        gameEngine.handleAnswerSubmit(io, socket, room, payload);
      } catch (err) {
        console.error('[lobbyHandler] Error in answer:submit:', err);
        socket.emit('answer:rejected', { reason: 'server_error' });
      }
    });

    // -------------------------------------------------------------
    // 5. Handle Disconnections
    // -------------------------------------------------------------
    socket.on('disconnect', () => {
      try {
        const meta = socketMeta.get(socket.id);
        if (!meta) return;

        const { pin, isHost, playerName } = meta;
        socketMeta.delete(socket.id);
        const room = rooms.get(pin);
        if (!room) return;

        if (isHost) {
          console.log(`[lobbyHandler] Host disconnected from room ${pin}. Closing room.`);
          gameEngine.clearRoomTimers(room);
          io.to(room.roomId).emit('quiz:error', { message: 'Host disconnected. The quiz room has closed.' });
          io.to(room.roomId).emit('quiz:ended', {
            winner: null,
            finalRanks: gameEngine.getLeaderboard(room),
            message: 'Host disconnected.'
          });
          rooms.delete(pin);
        } else {
          console.log(`[lobbyHandler] Player "${playerName}" disconnected from room ${pin}.`);
          if (room.status === 'LOBBY') {
            // Remove from lobby
            room.players = room.players.filter(p => p.socketId !== socket.id);
            io.to(room.roomId).emit('lobby:update', {
              players: room.players.map(p => ({
                name: p.name,
                score: p.score,
                connected: p.connected
              }))
            });
          } else {
            // Mid-game: mark disconnected
            const player = room.players.find(p => p.socketId === socket.id);
            if (player) {
              player.connected = false;
            }

            // If in active question, check if all remaining connected players have submitted
            if (room.status === 'QUESTION_ACTIVE') {
              const connectedPlayers = room.players.filter(p => p.connected);
              const answeredPlayers = connectedPlayers.filter(p => p.currentAnswer !== null);

              if (connectedPlayers.length > 0 && answeredPlayers.length >= connectedPlayers.length) {
                gameEngine.clearRoomTimers(room);
                gameEngine.endQuestionRound(io, room);
              }
            }
          }
        }
      } catch (err) {
        console.error('[lobbyHandler] Error handling disconnect:', err);
      }
    });
  });
}

module.exports = {
  rooms,
  socketMeta,
  generatePin,
  selectQuestions,
  registerSocketHandlers
};
