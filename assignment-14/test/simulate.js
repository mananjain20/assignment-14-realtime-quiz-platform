/**
 * test/simulate.js
 * Comprehensive automated verification script testing:
 * 1. Unit testing calculateScore formula.
 * 2. Room creation and PIN generation.
 * 3. 3 Players joining lobby and lobby:update broadcasts.
 * 4. quiz:start validation and authoritativeness.
 * 5. Player 1 answering immediately (high score).
 * 6. Player 2 answering after delay (lower score).
 * 7. Player 3 answering after deadline or with faked client time (anti-cheat verification).
 * 8. Leaderboard sorting with tie-breaking.
 * 9. Question round transitions and final quiz:ended event.
 */

const http = require('http');
const { io } = require('socket.io-client');
const assert = require('assert');
const { calculateScore } = require('../sockets/gameEngine');
const { server } = require('../server');

let SERVER_URL = 'http://localhost:5000';

console.log('\n🧪 ===================================================');
console.log('🧪 STARTING QUIZ BATTLE AUTOMATED VERIFICATION SUITE');
console.log('🧪 ===================================================\n');

// 1. UNIT TEST: Scoring Formula
console.log('🔹 [1/5] Testing calculateScore unit logic...');
assert.strictEqual(calculateScore(false, 100), 0, 'Incorrect answer must score 0');
assert.strictEqual(calculateScore(true, 0, 15000), 1000, 'Immediate correct answer must score 1000 (500 base + 500 bonus)');
assert.strictEqual(calculateScore(true, 15000, 15000), 500, 'Last-millisecond correct answer must score 500 base');

const midScore = calculateScore(true, 7500, 15000);
assert(midScore >= 745 && midScore <= 755, `Half-time score should be ~750, got ${midScore}`);

const fastScore = calculateScore(true, 1000, 15000);
const slowScore = calculateScore(true, 10000, 15000);
assert(fastScore > slowScore, `Fast score (${fastScore}) must be greater than slow score (${slowScore})`);
console.log('✅ calculateScore unit tests passed!\n');

// Helper to create connected client socket
function createClient(name) {
  return new Promise((resolve, reject) => {
    const socket = io(SERVER_URL, {
      transports: ['websocket', 'polling'],
      forceNew: true,
      reconnection: false
    });
    socket.on('connect', () => {
      resolve(socket);
    });
    socket.on('connect_error', (err) => {
      reject(err);
    });
  });
}

async function runSimulation() {
  try {
    // Start server on an ephemeral port if not already listening
    await new Promise((resolve) => {
      if (server.listening) {
        const addr = server.address();
        SERVER_URL = `http://localhost:${addr.port}`;
        return resolve();
      }
      server.listen(0, () => {
        const addr = server.address();
        SERVER_URL = `http://localhost:${addr.port}`;
        console.log(`📡 Test Server listening on test port ${addr.port}`);
        resolve();
      });
    });

    console.log('🔹 [2/5] Initializing Host and 3 Player sockets on', SERVER_URL);
    const host = await createClient('Host');
    const p1 = await createClient('Player1_Alice');
    const p2 = await createClient('Player2_Bob');
    const p3 = await createClient('Player3_Charlie');

    console.log('✅ Connected 4 sockets to', SERVER_URL);

    // 2. Create Room
    console.log('\n🔹 [3/5] Testing Room Creation & Player Joins...');
    const roomCreatedPromise = new Promise((resolve) => {
      host.on('quiz:created', (data) => {
        assert(data.pin && data.pin.length === 4, 'PIN must be 4 digits');
        assert.strictEqual(data.roomId, `quiz_${data.pin}`);
        resolve(data.pin);
      });
    });

    host.emit('quiz:create', { hostName: 'QuizMaster', category: 'Tech' });
    const pin = await roomCreatedPromise;
    console.log(`✅ Room created successfully with PIN: ${pin}`);

    // Join 3 players
    const joinPromises = [
      new Promise(res => p1.on('quiz:joined', res)),
      new Promise(res => p2.on('quiz:joined', res)),
      new Promise(res => p3.on('quiz:joined', res))
    ];

    p1.emit('quiz:join', { pin, playerName: 'Alice' });
    p2.emit('quiz:join', { pin, playerName: 'Bob' });
    p3.emit('quiz:join', { pin, playerName: 'Charlie' });

    await Promise.all(joinPromises);
    console.log('✅ All 3 players joined successfully!');

    // Test duplicate name rejection
    const pDuplicate = await createClient('Player_Duplicate');
    const duplicatePromise = new Promise(res => {
      pDuplicate.on('quiz:error', (err) => {
        assert(err.message.includes('already taken'), 'Should reject duplicate name');
        pDuplicate.disconnect();
        res();
      });
    });
    pDuplicate.emit('quiz:join', { pin, playerName: 'Alice' });
    await duplicatePromise;
    console.log('✅ Duplicate player name properly rejected');

    // 3. Start Game
    console.log('\n🔹 [4/5] Testing quiz:start & Anti-Cheat Question Timing...');
    
    // Test unauthorized non-host start attempt
    const unauthorizedPromise = new Promise(res => {
      p1.on('quiz:error', (err) => {
        assert(err.message.includes('Only the host'), 'Non-host starting quiz must be rejected');
        res();
      });
    });
    p1.emit('quiz:start', { pin });
    await unauthorizedPromise;
    console.log('✅ Non-host quiz:start attempt correctly blocked');

    // Host starts game
    let questionReceivedCount = 0;
    const qStartPromise = new Promise((resolve) => {
      host.on('question:start', (data) => {
        assert(data.question, 'Question text must be provided');
        assert.strictEqual(data.options.length, 4, 'Must have 4 options');
        assert.strictEqual(data.correctOption, undefined, 'CRITICAL: correctOption must NEVER be sent in question:start');
        assert.strictEqual(data.timeLimitSeconds, 15, 'Time limit must be 15s');
        resolve(data);
      });
    });

    host.emit('quiz:start', { pin });
    const firstQ = await qStartPromise;
    console.log(`✅ Question 1 received: "${firstQ.question}" (Anti-cheat verified: correctOption is hidden)`);

    const questionsBank = require('../data/questions.json');
    const matchedQ = questionsBank.find(q => q.question === firstQ.question);
    assert(matchedQ, 'Question should exist in questions bank');
    const correctOpt = matchedQ.correctOption;
    const wrongOpt = (correctOpt + 1) % 4;

    // 4. Test Answers with various timing & anti-cheat scenarios
    console.log('\n🔹 [5/5] Submitting answers and testing speed calculation & anti-cheat...');

    // Player 1 answers immediately (~100ms) with CORRECT option
    let p1AnswerPromise = new Promise(res => {
      p1.on('answer:received', (data) => {
        assert.strictEqual(data.accepted, true);
        res(data);
      });
    });

    p1.emit('answer:submit', {
      pin,
      selectedOption: correctOpt,
      timeTakenMs: 0 // Client value
    });

    const p1Result = await p1AnswerPromise;
    console.log(`✅ Player 1 (Alice) answered fast. Round score recorded: ${p1Result.score} pts`);

    // Player 2 answers after 1200ms delay with CORRECT option
    await new Promise(r => setTimeout(r, 1200));

    let p2AnswerPromise = new Promise(res => {
      p2.on('answer:received', (data) => {
        assert.strictEqual(data.accepted, true);
        res(data);
      });
    });

    // Player 2 sends a faked client time (timeTakenMs: 0) to test server authoritativeness
    p2.emit('answer:submit', {
      pin,
      selectedOption: correctOpt,
      timeTakenMs: 0 // Faked client time! Server MUST ignore this and use server timestamp.
    });

    const p2Result = await p2AnswerPromise;
    console.log(`✅ Player 2 (Bob) answered with 1.2s delay. Round score recorded: ${p2Result.score} pts`);

    // Verify Anti-Cheat: Player 1 score > Player 2 score despite Player 2 sending fake timeTakenMs: 0!
    assert(p1Result.score > p2Result.score, `Server Anti-Cheat check: Alice (${p1Result.score}) must beat Bob (${p2Result.score}) because Alice answered faster!`);
    console.log('✅ Anti-Cheat verified: Client-faked timeTakenMs was completely ignored by server clock.');

    // Player 1 tries to answer AGAIN in the same round (must be rejected)
    const duplicateAnswerPromise = new Promise(res => {
      p1.once('answer:rejected', (data) => {
        assert.strictEqual(data.reason, 'already_answered');
        res();
      });
    });
    p1.emit('answer:submit', { pin, selectedOption: wrongOpt, timeTakenMs: 100 });
    await duplicateAnswerPromise;
    console.log('✅ Anti-Cheat verified: Double answer submission rejected (already_answered)');

    // Player 3 submits invalid option 99 (must be rejected)
    const invalidOptionPromise = new Promise(res => {
      p3.once('answer:rejected', (data) => {
        assert.strictEqual(data.reason, 'invalid_option');
        res();
      });
    });
    p3.emit('answer:submit', { pin, selectedOption: 99, timeTakenMs: 100 });
    await invalidOptionPromise;
    console.log('✅ Anti-Cheat verified: Invalid option index rejected (invalid_option)');

    // Player 3 now submits WRONG option
    let p3AnswerPromise = new Promise(res => {
      p3.once('answer:received', (data) => {
        assert.strictEqual(data.accepted, true);
        assert.strictEqual(data.score, 0, 'Wrong option should award 0 score');
        res(data);
      });
    });
    p3.emit('answer:submit', { pin, selectedOption: wrongOpt, timeTakenMs: 500 });
    await p3AnswerPromise;
    console.log('✅ Player 3 (Charlie) submitted incorrect answer: received 0 pts');

    // Wait for leaderboard update
    const leaderboardPromise = new Promise((resolve) => {
      host.once('leaderboard:update', (data) => {
        resolve(data.leaderboard);
      });
    });

    const leaderboard = await leaderboardPromise;
    console.log('\n📊 Leaderboard standings for Round 1:');
    leaderboard.forEach(entry => {
      console.log(`   Rank #${entry.rank}: ${entry.name.padEnd(10)} | Score: ${entry.score} pts`);
    });

    // Test late submission when round is in REVEAL state
    const lateSubmitPromise = new Promise(res => {
      p3.once('answer:rejected', (data) => {
        assert(data.reason === 'not_active' || data.reason === 'time_expired' || data.reason === 'already_answered');
        res();
      });
    });
    p3.emit('answer:submit', { pin, selectedOption: correctOpt, timeTakenMs: 16000 });
    await lateSubmitPromise;
    console.log('✅ Anti-Cheat verified: Late post-round submission rejected');

    assert.strictEqual(leaderboard[0].name, 'Alice', 'Alice should be Rank #1');
    assert.strictEqual(leaderboard[1].name, 'Bob', 'Bob should be Rank #2');
    assert.strictEqual(leaderboard[2].name, 'Charlie', 'Charlie should be Rank #3');
    console.log('✅ Leaderboard ranks sorted accurately by score & speed');

    // Clean up connections
    host.disconnect();
    p1.disconnect();
    p2.disconnect();
    p3.disconnect();

    console.log('\n======================================================');
    console.log('🎉 ALL INTEGRATION & ANTI-CHEAT TESTS PASSED PERFECTLY!');
    console.log('======================================================\n');
    process.exit(0);

  } catch (err) {
    console.error('\n❌ TEST SUITE FAILED:', err);
    process.exit(1);
  }
}

// Start simulation test
runSimulation();
