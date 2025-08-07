// server.js - Servidor principal para Railway
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

// Rutas de autenticación
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;

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
        id: usuario.id,
        username: usuario.nombre,
        email: usuario.email
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

    // Intentar login con Supabase
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: username.includes('@') ? username : `${username}@temp.com`, // Permitir login con username
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
        id: usuario.id,
        username: usuario.nombre,
        email: usuario.email
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

// Rutas protegidas
app.get('/api/contacts', authenticateToken, async (req, res) => {
  try {
    // Obtener conversaciones del usuario
    const { data: conversaciones, error } = await supabase
      .rpc('get_conversaciones');

    if (error) {
      throw error;
    }

    // Formatear respuesta para el cliente
    const contactos = conversaciones.map(conv => ({
      id: conv.contacto_id,
      username: conv.contacto_nombre,
      foto: conv.contacto_foto || 'default.jpg',
      online: conv.contacto_estado === 'online',
      ultimo_acceso: conv.contacto_last_seen ? 
        formatearTiempo(conv.contacto_last_seen) : 'Nunca',
      ultimoMensaje: conv.ultimo_mensaje || '',
      horaUltimoMensaje: conv.ultimo_mensaje_fecha ? 
        formatearHora(conv.ultimo_mensaje_fecha) : '',
      mensajesNoLeidos: conv.mensajes_no_leidos || 0
    }));

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

    const { data: usuarios, error } = await supabase
      .rpc('buscar_usuarios', { termino: username });

    if (error) {
      throw error;
    }

    if (usuarios.length > 0) {
      res.json({
        success: true,
        usuario: {
          id: usuarios[0].id,
          username: usuarios[0].nombre,
          telefono: usuarios[0].telefono
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

    const { data: mensajes, error } = await supabase
      .rpc('get_mensajes_conversacion', { otro_usuario_id: otroUsuarioId });

    if (error) {
      throw error;
    }

    // Marcar mensajes como leídos
    await supabase
      .rpc('marcar_mensajes_leidos', { remitente_id: otroUsuarioId });

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

    const fileName = `${Date.now()}_${req.file.originalname}`;
    
    // Subir archivo a Supabase Storage
    const { data, error } = await supabase.storage
      .from('chat-files')
      .upload(fileName, req.file.buffer, {
        contentType: req.file.mimetype
      });

    if (error) {
      throw error;
    }

    // Obtener URL pública
    const { data: urlData } = supabase.storage
      .from('chat-files')
      .getPublicUrl(fileName);

    res.json({
      success: true,
      fileUrl: urlData.publicUrl,
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

// Socket.IO para chat en tiempo real
const usuarios_conectados = new Map();

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth.token;
    const decoded = jwt.verify(token, JWT_SECRET);
    socket.userId = decoded.userId;
    next();
  } catch (err) {
    next(new Error('Autenticación fallida'));
  }
});

io.on('connection', (socket) => {
  console.log(`Usuario conectado: ${socket.userId}`);
  
  // Agregar usuario a la lista de conectados
  usuarios_conectados.set(socket.userId, socket.id);

  // Notificar que el usuario está online
  socket.broadcast.emit('user_online', {
    user_id: socket.userId
  });

  // Actualizar estado en base de datos
  supabase
    .from('usuarios')
    .update({ estado: 'online' })
    .eq('id', socket.userId);

  // Manejar envío de mensajes
  socket.on('send_message', async (data) => {
    try {
      const { receiver_id, text, type = 'texto' } = data;

      // Guardar mensaje en base de datos
      const { data: mensaje, error } = await supabase
        .from('mensajes')
        .insert({
          remitente_id: socket.userId,
          destinatario_id: receiver_id,
          contenido: text,
          tipo: type
        })
        .select()
        .single();

      if (error) {
        throw error;
      }

      // Enviar mensaje al destinatario si está conectado
      const receptorSocketId = usuarios_conectados.get(receiver_id);
      if (receptorSocketId) {
        io.to(receptorSocketId).emit('new_message', {
          id: mensaje.id,
          remitente_id: mensaje.remitente_id,
          contenido: mensaje.contenido,
          tipo: mensaje.tipo,
          created_at: mensaje.created_at
        });
      }

      // Confirmar al remitente
      socket.emit('message_sent', {
        id: mensaje.id,
        timestamp: mensaje.created_at
      });

    } catch (error) {
      console.error('Error enviando mensaje:', error);
      socket.emit('message_error', { error: 'Error enviando mensaje' });
    }
  });

  // Manejar typing
  socket.on('typing', (data) => {
    const receptorSocketId = usuarios_conectados.get(data.receiver_id);
    if (receptorSocketId) {
      io.to(receptorSocketId).emit('user_typing', {
        user_id: socket.userId
      });
    }
  });

  socket.on('stop_typing', (data) => {
    const receptorSocketId = usuarios_conectados.get(data.receiver_id);
    if (receptorSocketId) {
      io.to(receptorSocketId).emit('user_stop_typing', {
        user_id: socket.userId
      });
    }
  });

  // Manejar desconexión
  socket.on('disconnect', () => {
    console.log(`Usuario desconectado: ${socket.userId}`);
    
    // Remover de usuarios conectados
    usuarios_conectados.delete(socket.userId);

    // Notificar que el usuario está offline
    socket.broadcast.emit('user_offline', {
      user_id: socket.userId
    });

    // Actualizar estado en base de datos
    supabase
      .from('usuarios')
      .update({ 
        estado: 'offline', 
        last_seen: new Date().toISOString() 
      })
      .eq('id', socket.userId);
  });
});

// Funciones auxiliares
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

// Ruta de prueba
app.get('/', (req, res) => {
  res.json({ 
    message: 'Chat API funcionando correctamente',
    timestamp: new Date().toISOString()
  });
});

// Puerto
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
