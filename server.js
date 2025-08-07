// server.js - Servidor completo para el chat
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// Configurar Socket.IO con CORS
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Middlewares
app.use(cors());
app.use(express.json());

// Cliente de Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'tu-jwt-secret-super-seguro';

// Configurar multer para subida de archivos
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 25 * 1024 * 1024, // 25MB
  }
});

// Middleware de autenticación
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ success: false, message: 'Token requerido' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(403).json({ success: false, message: 'Token inválido' });
  }
};

// ========== RUTAS DE AUTENTICACIÓN ==========

app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;

    // Validar datos
    if (!username || !email || !password) {
      return res.status(400).json({ 
        success: false, 
        message: 'Todos los campos son requeridos' 
      });
    }

    // Registrar usuario en Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      user_metadata: { nombre: username }
    });

    if (authError) {
      return res.status(400).json({ 
        success: false, 
        message: authError.message 
      });
    }

    // Crear token JWT
    const token = jwt.sign(
      { 
        userId: authData.user.id, 
        email: authData.user.email 
      }, 
      JWT_SECRET, 
      { expiresIn: '30d' }
    );

    // Obtener datos del usuario creado
    const { data: usuario } = await supabase
      .from('usuarios')
      .select('*')
      .eq('id', authData.user.id)
      .single();

    res.json({
      success: true,
      token,
      usuario: {
        id: usuario?.id || authData.user.id,
        username: usuario?.nombre || username,
        email: usuario?.email || email
      }
    });

  } catch (error) {
    console.error('Error en registro:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error interno del servidor' 
    });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ 
        success: false, 
        message: 'Username y password son requeridos' 
      });
    }

    // Intentar login con Supabase
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: username.includes('@') ? username : `${username}@temp.com`,
      password
    });

    if (authError) {
      return res.status(401).json({ 
        success: false, 
        message: 'Credenciales incorrectas' 
      });
    }

    // Crear token JWT
    const token = jwt.sign(
      { 
        userId: authData.user.id, 
        email: authData.user.email 
      }, 
      JWT_SECRET, 
      { expiresIn: '30d' }
    );

    // Obtener datos del usuario
    const { data: usuario } = await supabase
      .from('usuarios')
      .select('*')
      .eq('id', authData.user.id)
      .single();

    // Actualizar estado a online
    await supabase
      .from('usuarios')
      .update({ estado: 'online', last_seen: new Date().toISOString() })
      .eq('id', authData.user.id);

    res.json({
      success: true,
      token,
      usuario: {
        id: usuario?.id || authData.user.id,
        username: usuario?.nombre || username,
        email: usuario?.email || authData.user.email
      }
    });

  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error interno del servidor' 
    });
  }
});

// ========== RUTAS PROTEGIDAS ==========

app.get('/api/contacts', authenticateToken, async (req, res) => {
  try {
    // Por ahora, devolvemos una lista de prueba
    // Más tarde implementaremos con Supabase
    const contactos = [
      {
        id: 'user1',
        username: 'Usuario Demo',
        foto: 'default.jpg',
        online: true,
        ultimo_acceso: 'Ahora',
        ultimoMensaje: 'Hola, ¿cómo estás?',
        horaUltimoMensaje: '14:30',
        mensajesNoLeidos: 2
      }
    ];

    res.json(contactos);

  } catch (error) {
    console.error('Error obteniendo contactos:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error obteniendo contactos' 
    });
  }
});

app.post('/api/users/search', authenticateToken, async (req, res) => {
  try {
    const { username } = req.body;

    if (!username) {
      return res.status(400).json({
        success: false,
        message: 'Username es requerido'
      });
    }

    // Por ahora, respuesta de prueba
    if (username.toLowerCase() === 'demo') {
      res.json({
        success: true,
        usuario: {
          id: 'demo-user-id',
          username: 'Demo User',
          telefono: '+1234567890'
        }
      });
    } else {
      res.json({
        success: false,
        message: 'Usuario no encontrado'
      });
    }

  } catch (error) {
    console.error('Error buscando usuario:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error buscando usuario' 
    });
  }
});

app.get('/api/messages/:userId', authenticateToken, async (req, res) => {
  try {
    const otroUsuarioId = req.params.userId;

    // Por ahora, mensajes de prueba
    const mensajes = [
      {
        id: 'msg1',
        remitente_id: otroUsuarioId,
        destinatario_id: req.user.userId,
        contenido: '¡Hola! ¿Cómo estás?',
        tipo: 'texto',
        created_at: new Date(Date.now() - 300000).toISOString() // 5 min ago
      },
      {
        id: 'msg2',
        remitente_id: req.user.userId,
        destinatario_id: otroUsuarioId,
        contenido: '¡Hola! Todo bien, ¿y tú?',
        tipo: 'texto',
        created_at: new Date(Date.now() - 240000).toISOString() // 4 min ago
      }
    ];

    res.json(mensajes);

  } catch (error) {
    console.error('Error obteniendo mensajes:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error obteniendo mensajes' 
    });
  }
});

app.post('/api/files/upload', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        message: 'No se recibió archivo' 
      });
    }

    // Por ahora, simulamos la subida del archivo
    const fileName = `${Date.now()}_${req.file.originalname}`;
    
    // En producción, aquí subirías a Supabase Storage
    const fileUrl = `http://localhost:${process.env.PORT || 3000}/uploads/${fileName}`;

    res.json({
      success: true,
      fileUrl,
      fileName: req.file.originalname,
      fileSize: req.file.size
    });

  } catch (error) {
    console.error('Error subiendo archivo:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error subiendo archivo' 
    });
  }
});

// ========== SOCKET.IO PARA CHAT EN TIEMPO REAL ==========

const usuarios_conectados = new Map();

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth.token;
    const decoded = jwt.verify(token, JWT_SECRET);
    socket.userId = decoded.userId;
    socket.userEmail = decoded.email;
    next();
  } catch (err) {
    next(new Error('Autenticación fallida'));
  }
});

io.on('connection', (socket) => {
  console.log(`✅ Usuario conectado: ${socket.userId} (${socket.userEmail})`);
  
  // Agregar usuario a la lista de conectados
  usuarios_conectados.set(socket.userId, {
    socketId: socket.id,
    email: socket.userEmail,
    connectedAt: new Date()
  });

  // Notificar que el usuario está online
  socket.broadcast.emit('user_online', {
    user_id: socket.userId,
    email: socket.userEmail
  });

  // Enviar lista de usuarios conectados
  socket.emit('users_online', {
    count: usuarios_conectados.size,
    users: Array.from(usuarios_conectados.keys())
  });

  // Manejar envío de mensajes
  socket.on('send_message', async (data) => {
    try {
      const { receiver_id, text, type = 'texto' } = data;

      console.log(`📨 Mensaje de ${socket.userId} para ${receiver_id}: ${text}`);

      // Crear mensaje
      const mensaje = {
        id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        remitente_id: socket.userId,
        destinatario_id: receiver_id,
        contenido: text,
        tipo: type,
        created_at: new Date().toISOString()
      };

      // Enviar mensaje al destinatario si está conectado
      const receptor = usuarios_conectados.get(receiver_id);
      if (receptor) {
        io.to(receptor.socketId).emit('new_message', mensaje);
        console.log(`✅ Mensaje entregado a ${receiver_id}`);
      } else {
        console.log(`⚠️ Usuario ${receiver_id} no está conectado`);
      }

      // Confirmar al remitente
      socket.emit('message_sent', {
        id: mensaje.id,
        timestamp: mensaje.created_at,
        delivered: !!receptor
      });

    } catch (error) {
      console.error('❌ Error enviando mensaje:', error);
      socket.emit('message_error', { error: 'Error enviando mensaje' });
    }
  });

  // Manejar typing
  socket.on('typing', (data) => {
    const receptor = usuarios_conectados.get(data.receiver_id);
    if (receptor) {
      io.to(receptor.socketId).emit('user_typing', {
        user_id: socket.userId
      });
    }
  });

  socket.on('stop_typing', (data) => {
    const receptor = usuarios_conectados.get(data.receiver_id);
    if (receptor) {
      io.to(receptor.socketId).emit('user_stop_typing', {
        user_id: socket.userId
      });
    }
  });

  // Manejar desconexión
  socket.on('disconnect', () => {
    console.log(`❌ Usuario desconectado: ${socket.userId}`);
    
    // Remover de usuarios conectados
    usuarios_conectados.delete(socket.userId);

    // Notificar que el usuario está offline
    socket.broadcast.emit('user_offline', {
      user_id: socket.userId
    });
  });
});

// ========== FUNCIONES AUXILIARES ==========

function formatearTiempo(fecha) {
  const ahora = new Date();
  const fechaMensaje = new Date(fecha);
  const diffMs = ahora - fechaMensaje;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Ahora';
  if (diffMins < 60) return `Hace ${diffMins} min`;
  if (diffHours < 24) return `Hace ${diffHours}h`;
  if (diffDays === 1) return 'Ayer';
  if (diffDays < 7) return `Hace ${diffDays} días`;
  return fechaMensaje.toLocaleDateString();
}

function formatearHora(fecha) {
  return new Date(fecha).toLocaleTimeString('es-ES', {
    hour: '2-digit',
    minute: '2-digit'
  });
}

// ========== RUTAS DE PRUEBA ==========

app.get('/', (req, res) => {
  res.json({ 
    message: '🚀 Chat API funcionando correctamente',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    endpoints: {
      auth: [
        'POST /api/auth/register',
        'POST /api/auth/login'
      ],
      api: [
        'GET /api/contacts',
        'POST /api/users/search',
        'GET /api/messages/:userId',
        'POST /api/files/upload'
      ],
      websocket: 'Socket.IO en el mismo puerto'
    },
    connected_users: usuarios_conectados.size
  });
});

app.get('/api/status', (req, res) => {
  res.json({
    status: 'online',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    connected_users: usuarios_conectados.size,
    users_list: Array.from(usuarios_conectados.entries()).map(([userId, data]) => ({
      userId,
      email: data.email,
      connectedAt: data.connectedAt
    }))
  });
});

// Middleware para manejar errores 404
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint no encontrado',
    availableEndpoints: [
      'GET /',
      'GET /api/status',
      'POST /api/auth/register',
      'POST /api/auth/login',
      'GET /api/contacts',
      'POST /api/users/search',
      'GET /api/messages/:userId',
      'POST /api/files/upload'
    ]
  });
});

// ========== INICIAR SERVIDOR ==========

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log('🚀 ================================');
  console.log(`✅ Servidor corriendo en puerto ${PORT}`);
  console.log(`🌐 HTTP: http://localhost:${PORT}`);
  console.log(`🔌 Socket.IO: http://localhost:${PORT}`);
  console.log(`📊 Entorno: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔑 JWT configurado: ${JWT_SECRET ? '✅' : '❌'}`);
  console.log(`🗄️ Supabase configurado: ${process.env.SUPABASE_URL ? '✅' : '❌'}`);
  console.log('🚀 ================================');
});
