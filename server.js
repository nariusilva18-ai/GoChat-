/**
 * ============================================
 * GOCHAT BACKEND SERVER
 * API RESTful com WebSockets para Real-time
 * ============================================
 */

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const hpp = require('hpp');
const winston = require('winston');
require('dotenv').config();

// Importar rotas
const authRoutes = require('./src/routes/auth');
const userRoutes = require('./src/routes/users');
const chatRoutes = require('./src/routes/chats');
const liveRoutes = require('./src/routes/lives');
const matchRoutes = require('./src/routes/matching');
const paymentRoutes = require('./src/routes/payments');
const giftRoutes = require('./src/routes/gifts');
const postRoutes = require('./src/routes/posts');
const storyRoutes = require('./src/routes/stories');
const metricRoutes = require('./src/routes/metrics');
const notificationRoutes = require('./src/routes/notifications');

// Importar WebSocket handlers
const socketHandler = require('./src/websocket/socketHandler');

// Importar middleware
const errorHandler = require('./src/middleware/errorHandler');
const { authMiddleware } = require('./src/middleware/auth');

// Configurar logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' })
  ]
});

// Inicializar app
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.FRONTEND_URL || '*',
    methods: ['GET', 'POST'],
    credentials: true
  },
  pingTimeout: 60000,
  pingInterval: 25000
});

// Configurações de segurança
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      connectSrc: ["'self'", "ws:", "wss:", "https:"],
      imgSrc: ["'self'", "data:", "https:"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
    }
  }
}));

app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100, // 100 requisições por IP
  message: {
    success: false,
    message: 'Muitas requisições. Tente novamente mais tarde.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: {
    success: false,
    message: 'Muitas tentativas de login. Tente novamente em 15 minutos.'
  }
});

app.use(limiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

// Body parser
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Compressão
app.use(compression());

// Prevenir poluição de parâmetros HTTP
app.use(hpp());

// Logger de requisições
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.get('user-agent')
  });
  next();
});

// ============================================
// ROTAS API
// ============================================

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    uptime: process.uptime()
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', authMiddleware, userRoutes);
app.use('/api/chats', authMiddleware, chatRoutes);
app.use('/api/lives', authMiddleware, liveRoutes);
app.use('/api/matching', authMiddleware, matchRoutes);
app.use('/api/payments', authMiddleware, paymentRoutes);
app.use('/api/gifts', authMiddleware, giftRoutes);
app.use('/api/posts', authMiddleware, postRoutes);
app.use('/api/stories', authMiddleware, storyRoutes);
app.use('/api/metrics', authMiddleware, metricRoutes);
app.use('/api/notifications', authMiddleware, notificationRoutes);

// WebSocket authentication middleware
io.use((socket, next) => {
  const token = socket.handshake.auth.token || socket.handshake.query.token;
  if (!token) {
    return next(new Error('Autenticação necessária'));
  }
  
  try {
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'gochat-secret-key');
    socket.userId = decoded.userId;
    socket.username = decoded.username;
    next();
  } catch (err) {
    next(new Error('Token inválido'));
  }
});

// Inicializar WebSocket handlers
socketHandler(io);

// ============================================
// ERROR HANDLING
// ============================================

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Rota não encontrada'
  });
});

// Global error handler
app.use(errorHandler);

// ============================================
// START SERVER
// ============================================

const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';

server.listen(PORT, HOST, () => {
  logger.info(`🚀 GoChat Server iniciado`);
  logger.info(`📡 Porta: ${PORT}`);
  logger.info(`🌐 Ambiente: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`🔗 WebSocket: ws://${HOST}:${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM recebido. Encerrando servidor...');
  server.close(() => {
    logger.info('Servidor encerrado.');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT recebido. Encerrando servidor...');
  server.close(() => {
    logger.info('Servidor encerrado.');
    process.exit(0);
  });
});

module.exports = { app, server, io };
