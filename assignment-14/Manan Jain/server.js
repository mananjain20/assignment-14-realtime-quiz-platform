/**
 * server.js
 * Main server entry point wiring Express, HTTP, Socket.io, and static file serving.
 */

require('dotenv').config();
const http = require('http');
const path = require('path');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');

const { registerSocketHandlers } = require('./sockets/lobbyHandler');

const app = express();
const server = http.createServer(app);

// Enable CORS for Express and Socket.io
app.use(cors());
app.use(express.json());

// Serve static assets from the public directory
app.use(express.static(path.join(__dirname, 'public')));

// Root route fallback to index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Setup Socket.io with permissive CORS
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Register all socket event handlers
registerSocketHandlers(io);

const PORT = process.env.PORT || 5000;

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`⚠️ Port ${PORT} is already in use.`);
    console.error(`💡 Tip: On macOS, AirPlay Receiver frequently listens on port 5000.`);
    console.error(`   You can disable AirPlay Receiver in System Settings > General > AirDrop & AirPlay, or set PORT=5001 in .env.`);
  } else {
    console.error('Server error:', err);
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`=============================================`);
    console.log(`🚀 Quiz Battle Server running at: http://localhost:${PORT}`);
    console.log(`🎮 Host Portal:   http://localhost:${PORT}/host.html`);
    console.log(`📱 Player Pad:    http://localhost:${PORT}/player.html`);
    console.log(`=============================================`);
  });
}

module.exports = { app, server, io };
