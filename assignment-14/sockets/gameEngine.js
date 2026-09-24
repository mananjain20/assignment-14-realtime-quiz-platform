/**
 * gameEngine.js
 * Authoritative game state machine, timers, round transitions, anti-cheat validation, scoring, and leaderboard.
 */

const QUESTION_TIME_LIMIT_MS = 15000; // 15 seconds per question
const REVEAL_DELAY_MS = 5000;         // 5 seconds delay to show explanation & leaderboard

/**
 * Server-authoritative scoring formula
 * @param {boolean} isCorrect 
 * @param {number} timeTakenMs 
 * @param {number} totalTimeLimitMs 
 * @returns {number} Score between 0 and 1000
 */
function calculateScore(isCorrect, timeTakenMs, totalTimeLimitMs = QUESTION_TIME_LIMIT_MS) {
  if (!isCorrect) return 0;
  const clampedTime = Math.max(0, Math.min(timeTakenMs, totalTimeLimitMs));
  const timeRemaining = Math.max(0, totalTimeLimitMs - clampedTime);
  const speedBonus = Math.round((timeRemaining / totalTimeLimitMs) * 500);
  return 500 + speedBonus; // max 1000 (500 base + up to 500 speed bonus)
}

/**
 * Generates sorted leaderboard with ranks
 * @param {Object} room 
 * @returns {Array} [{ rank, name, score, totalResponseTimeMs }]
 */
function getLeaderboard(room) {
  if (!room || !room.players) return [];

  // Sort by score DESC, then totalResponseTimeMs ASC (faster wins tie), then name ASC
  const sorted = [...room.players].sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    if ((a.totalResponseTimeMs || 0) !== (b.totalResponseTimeMs || 0)) {
      return (a.totalResponseTimeMs || 0) - (b.totalResponseTimeMs || 0);
    }
    return a.name.localeCompare(b.name);
  });

  return sorted.map((player, index) => ({
    rank: index + 1,
    name: player.name,
    score: player.score,
    totalResponseTimeMs: player.totalResponseTimeMs || 0,
    connected: player.connected
  }));
}

/**
 * Clears all active timers for a room
 * @param {Object} room 
 */
function clearRoomTimers(room) {
  if (!room) return;
  if (room.timerInterval) {
    clearInterval(room.timerInterval);
    room.timerInterval = null;
  }
  if (room.questionTimeout) {
    clearTimeout(room.questionTimeout);
    room.questionTimeout = null;
  }
  if (room.nextRoundTimeout) {
    clearTimeout(room.nextRoundTimeout);
    room.nextRoundTimeout = null;
  }
}

/**
 * Starts the quiz by resetting state and starting Question 1
 * @param {Object} io 
 * @param {Object} room 
 */
function startQuiz(io, room) {
  clearRoomTimers(room);
  room.currentQuestionIndex = 0;
  room.players.forEach(p => {
    p.score = 0;
    p.totalResponseTimeMs = 0;
    p.currentAnswer = null;
  });

  startQuestion(io, room);
}

/**
 * Starts a question round with server-authoritative timers
 * @param {Object} io 
 * @param {Object} room 
 */
function startQuestion(io, room) {
  clearRoomTimers(room);

  const qIndex = room.currentQuestionIndex;
  const currentQ = room.questions[qIndex];

  if (!currentQ) {
    endQuiz(io, room);
    return;
  }

  // Reset player answers for this round
  room.players.forEach(p => {
    p.currentAnswer = null;
  });

  room.status = 'QUESTION_ACTIVE';
  room.serverStartTs = Date.now();
  room.deadline = room.serverStartTs + QUESTION_TIME_LIMIT_MS;

  // Broadcast question to room quiz_<pin> WITHOUT correct answer
  io.to(room.roomId).emit('question:start', {
    questionIndex: qIndex + 1,
    totalQuestions: room.questions.length,
    question: currentQ.question,
    options: currentQ.options,
    timeLimitSeconds: Math.round(QUESTION_TIME_LIMIT_MS / 1000)
  });

  // Emit 1-second interval timer ticks for synced countdowns
  room.timerInterval = setInterval(() => {
    const remainingMs = Math.max(0, room.deadline - Date.now());
    io.to(room.roomId).emit('timer:tick', { remainingMs });

    if (remainingMs <= 0) {
      if (room.timerInterval) {
        clearInterval(room.timerInterval);
        room.timerInterval = null;
      }
    }
  }, 1000);

  // Authoritative round timeout
  room.questionTimeout = setTimeout(() => {
    if (room.status === 'QUESTION_ACTIVE') {
      endQuestionRound(io, room);
    }
  }, QUESTION_TIME_LIMIT_MS);
}

/**
 * Handles player answer submission with full anti-cheat checks
 * @param {Object} io 
 * @param {Object} socket 
 * @param {Object} room 
 * @param {Object} payload { pin, selectedOption, timeTakenMs }
 */
function handleAnswerSubmit(io, socket, room, payload) {
  try {
    const { selectedOption } = payload || {};
    const now = Date.now();

    // 1. Validate room state
    if (!room || room.status !== 'QUESTION_ACTIVE') {
      socket.emit('answer:rejected', { reason: 'not_active' });
      return;
    }

    // 2. Anti-cheat: Check deadline based strictly on server clock
    if (now > room.deadline) {
      socket.emit('answer:rejected', { reason: 'time_expired' });
      return;
    }

    // 3. Find registered player
    const player = room.players.find(p => p.socketId === socket.id);
    if (!player) {
      socket.emit('answer:rejected', { reason: 'unauthorized' });
      return;
    }

    // 4. Check if already answered
    if (player.currentAnswer !== null) {
      socket.emit('answer:rejected', { reason: 'already_answered' });
      return;
    }

    // 5. Validate option index (integer 0..3)
    if (typeof selectedOption !== 'number' || !Number.isInteger(selectedOption) || selectedOption < 0 || selectedOption > 3) {
      socket.emit('answer:rejected', { reason: 'invalid_option' });
      return;
    }

    // 6. Calculate server-authoritative elapsed time (IGNORE client-provided timeTakenMs)
    const serverTimeTakenMs = Math.max(0, now - room.serverStartTs);

    const currentQ = room.questions[room.currentQuestionIndex];
    const isCorrect = (selectedOption === currentQ.correctOption);
    const roundScore = calculateScore(isCorrect, serverTimeTakenMs, QUESTION_TIME_LIMIT_MS);

    // Update player record
    player.score += roundScore;
    player.totalResponseTimeMs = (player.totalResponseTimeMs || 0) + serverTimeTakenMs;
    player.currentAnswer = {
      selectedOption,
      timeTakenMs: serverTimeTakenMs,
      isCorrect,
      roundScore
    };

    // Acknowledge answer to player
    socket.emit('answer:received', {
      accepted: true,
      score: roundScore
    });

    // Notify host/room about answer count progress
    const connectedPlayers = room.players.filter(p => p.connected);
    const answeredPlayers = connectedPlayers.filter(p => p.currentAnswer !== null);

    io.to(room.roomId).emit('answer:count_update', {
      answeredCount: answeredPlayers.length,
      totalPlayers: connectedPlayers.length
    });

    // If ALL connected players have answered, immediately end the round early!
    if (connectedPlayers.length > 0 && answeredPlayers.length >= connectedPlayers.length) {
      clearRoomTimers(room);
      endQuestionRound(io, room);
    }
  } catch (err) {
    console.error(`[gameEngine] Error in handleAnswerSubmit:`, err);
    socket.emit('quiz:error', { message: 'Server error processing answer.' });
  }
}

/**
 * Ends the question round, reveals correct answer + explanation, and broadcasts leaderboard
 * @param {Object} io 
 * @param {Object} room 
 */
function endQuestionRound(io, room) {
  clearRoomTimers(room);
  room.status = 'REVEAL';

  const currentQ = room.questions[room.currentQuestionIndex];

  // 1. Reveal correct answer & explanation
  io.to(room.roomId).emit('question:time_up', {
    correctOption: currentQ.correctOption,
    explanation: currentQ.explanation
  });

  // 2. Broadcast leaderboard
  const leaderboard = getLeaderboard(room);
  io.to(room.roomId).emit('leaderboard:update', { leaderboard });

  // 3. Auto-transition to next question or end quiz after REVEAL_DELAY_MS
  room.nextRoundTimeout = setTimeout(() => {
    if (room.status !== 'REVEAL') return;

    if (room.currentQuestionIndex + 1 < room.questions.length) {
      room.currentQuestionIndex++;
      startQuestion(io, room);
    } else {
      endQuiz(io, room);
    }
  }, REVEAL_DELAY_MS);
}

/**
 * Concludes the quiz, determines winners, and schedules memory cleanup
 * @param {Object} io 
 * @param {Object} room 
 * @param {Map} roomsMap 
 */
function endQuiz(io, room, roomsMap) {
  clearRoomTimers(room);
  room.status = 'ENDED';

  const finalRanks = getLeaderboard(room);
  const winner = finalRanks.length > 0 ? { name: finalRanks[0].name, score: finalRanks[0].score } : null;

  io.to(room.roomId).emit('quiz:ended', {
    winner,
    finalRanks
  });

  // Schedule cleanup after 60s
  if (room.cleanupTimeout) clearTimeout(room.cleanupTimeout);
  room.cleanupTimeout = setTimeout(() => {
    if (roomsMap && roomsMap.has(room.pin)) {
      roomsMap.delete(room.pin);
      console.log(`[gameEngine] Cleaned up room ${room.pin} from memory.`);
    }
  }, 60000);
}

module.exports = {
  QUESTION_TIME_LIMIT_MS,
  REVEAL_DELAY_MS,
  calculateScore,
  getLeaderboard,
  clearRoomTimers,
  startQuiz,
  startQuestion,
  handleAnswerSubmit,
  endQuestionRound,
  endQuiz
};
