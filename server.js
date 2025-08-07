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
    console.log('📝 Solicitud de registro recibida:', req.body);
    
    const { username, email, password } = req.body;

    // Validar datos
    if (!username || !email || !password) {
      console.log('❌ Datos faltantes en el registro');
      return res.status(400).json({ 
        success: false, 
        message: 'Username, email y password son requeridos' 
      });
    }

    // Validar formato de email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Formato de email inválido' 
      });
    }

    // Validar longitud de username
    if (username.length < 3) {
      return res.status(400).json({ 
        success: false, 
        message: 'El username debe tener al menos 3 caracteres' 
      });
    }

    // Validar formato de username
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      return res.status(400).json({ 
        success: false, 
        message: 'El username solo puede contener letras, números y guiones bajos' 
      });
    }

    // Validar longitud de password
    if (password.length < 6) {
      return res.status(400).json({ 
        success: false, 
        message: 'La contraseña debe tener al menos 6 caracteres' 
      });
    }

    console.log(`📧 Intentando registrar usuario: ${username} con email: ${email}`);

    // Verificar si el usuario ya existe en nuestra tabla
    const { data: usuarioExistente, error: checkError } = await supabase
      .from('usuarios')
      .select('email, nombre')
      .or(`email.eq.${email},nombre.eq.${username}`)
      .maybeSingle(); // Usar maybeSingle() en lugar de single()

    if (checkError && checkError.code !== 'PGRST116') {
      console.log('❌ Error verificando usuario existente:', checkError);
      return res.status(500).json({ 
        success: false, 
        message: 'Error verificando usuario existente' 
      });
    }

    if (usuarioExistente) {
      return res.status(409).json({ 
        success: false, 
        message: usuarioExistente.email === email ? 'El email ya está registrado' : 'El username ya está en uso'
      });
    }

    // Registrar usuario en Supabase Auth con metadata
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      user_metadata: { 
        nombre: username,
        username: username 
      },
      email_confirm: true // Confirmar email automáticamente
    });

    if (authError) {
      console.log('❌ Error de Supabase Auth:', authError);
      
      // Manejar errores específicos de Supabase
      if (authError.message.includes('already registered') || authError.message.includes('already exists')) {
        return res.status(409).json({ 
          success: false, 
          message: 'El email ya está registrado' 
        });
      }
      
      if (authError.message.includes('Password should be')) {
        return res.status(400).json({ 
          success: false, 
          message: 'La contraseña no cumple con los requisitos mínimos' 
        });
      }

      return res.status(400).json({ 
        success: false, 
        message: `Error de registro: ${authError.message}` 
      });
    }

    console.log('✅ Usuario creado en Supabase Auth:', authData.user.id);

    // Crear token JWT
    const token = jwt.sign(
      { 
        userId: authData.user.id, 
        email: authData.user.email,
        username: username
      }, 
      JWT_SECRET, 
      { expiresIn: '30d' }
    );

    // Dar tiempo para que el trigger cree el perfil y reintentar si es necesario
    let usuario = null;
    let intentos = 0;
    const maxIntentos = 5;

    while (!usuario && intentos < maxIntentos) {
      await new Promise(resolve => setTimeout(resolve, 500 * (intentos + 1))); // Espera incremental
      
      const { data: usuarioData, error: userError } = await supabase
        .from('usuarios')
        .select('*')
        .eq('id', authData.user.id)
        .maybeSingle();

      if (userError && userError.code !== 'PGRST116') {
        console.log(`⚠️ Error obteniendo usuario (intento ${intentos + 1}):`, userError);
      } else if (usuarioData) {
        usuario = usuarioData;
        break;
      }
      
      intentos++;
      console.log(`🔄 Reintentando obtener usuario ${intentos}/${maxIntentos}...`);
    }

    // Si después de todos los intentos no se creó el perfil, crearlo manualmente
    if (!usuario) {
      console.log('⚠️ Perfil no encontrado, creando manualmente...');
      
      const { data: perfilCreado, error: createError } = await supabase
        .from('usuarios')
        .insert({
          id: authData.user.id,
          email: authData.user.email,
          nombre: username,
          estado: 'online',
          last_seen: new Date().toISOString()
        })
        .select()
        .single();

      if (createError) {
        console.log('❌ Error creando perfil manualmente:', createError);
        // Aunque falle el perfil, el usuario se creó exitosamente
        usuario = {
          id: authData.user.id,
          nombre: username,
          email: authData.user.email
        };
      } else {
        usuario = perfilCreado;
      }
    }

    console.log('✅ Registro exitoso para:', username);

    res.json({
      success: true,
      message: 'Usuario registrado exitosamente',
      token,
      usuario: {
        id: authData.user.id,
        username: usuario.nombre || username,
        email: authData.user.email
      }
    });

  } catch (error) {
    console.error('❌ Error en registro:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error interno del servidor'
    });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    console.log('🔐 Solicitud de login recibida:', req.body);
    
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ 
        success: false, 
        message: 'Username y password son requeridos' 
      });
    }

    // Determinar si es email o username
    const isEmail = username.includes('@');
    let email = username;

    // Si no es email, buscar el email por username
    if (!isEmail) {
      const { data: usuario } = await supabase
        .from('usuarios')
        .select('email')
        .eq('nombre', username)
        .single();

      if (!usuario) {
        return res.status(401).json({ 
          success: false, 
          message: 'Usuario no encontrado' 
        });
      }
      email = usuario.email;
    }

    console.log(`🔍 Intentando login con email: ${email}`);

    // Intentar login con Supabase
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (authError) {
      console.log('❌ Error de autenticación:', authError.message);
      return res.status(401).json({ 
        success: false, 
        message: 'Credenciales incorrectas' 
      });
    }

    console.log('✅ Autenticación exitosa para:', authData.user.email);

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

    console.log('✅ Login exitoso para:', usuario?.nombre || username);

    res.json({
      success: true,
      message: 'Login exitoso',
      token,
      usuario: {
        id: authData.user.id,
        username: usuario?.nombre || username,
        email: authData.user.email
      }
    });

  } catch (error) {
    console.error('❌ Error en login:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error interno del servidor: ' + error.message
    });
  }
});

// ========== RUTAS PROTEGIDAS ==========

app.get('/api/contacts', authenticateToken, async (req, res) => {
  try {
    // Obtener conversaciones del usuario actual
    const { data: conversaciones, error } = await supabase
      .rpc('get_conversaciones');

    if (error) {
      console.error('Error obteniendo conversaciones:', error);
      // Fallback a datos de prueba
      const contactos = [
        {
          id: 'demo-user',
          username: 'Usuario Demo',
          foto: null,
          online: true,
          ultimo_acceso: 'Ahora',
          ultimoMensaje: 'Hola, ¿cómo estás?',
          horaUltimoMensaje: '14:30',
          mensajesNoLeidos: 0
        }
      ];
      return res.json(contactos);
    }

    const contactos = conversaciones.map(conv => ({
      id: conv.contacto_id,
      username: conv.contacto_nombre,
      foto: conv.contacto_foto,
      online: conv.contacto_estado === 'online',
      ultimo_acceso: formatearTiempo(conv.contacto_last_seen),
      ultimoMensaje: conv.ultimo_mensaje || 'Sin mensajes',
      horaUltimoMensaje: conv.ultimo_mensaje_fecha ? formatearHora(conv.ultimo_mensaje_fecha) : '',
      mensajesNoLeidos: parseInt(conv.mensajes_no_leidos) || 0
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

    if (!username || username.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: 'El término de búsqueda debe tener al menos 2 caracteres'
      });
    }

    const { data: usuarios, error } = await supabase
      .rpc('buscar_usuarios', { termino: username.trim() });

    if (error) {
      console.error('Error buscando usuario:', error);
      return res.status(500).json({
        success: false,
        message: 'Error en la búsqueda'
      });
    }

    if (usuarios && usuarios.length > 0) {
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
      console.error('Error obteniendo mensajes:', error);
      return res.status(500).json({ 
        success: false, 
        message: 'Error obteniendo mensajes' 
      });
    }

    // Marcar mensajes como leídos
    await supabase.rpc('marcar_mensajes_leidos', { 
      remitente_id: otroUsuarioId 
    });

    res.json(mensajes || []);

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
    
    // Subir a Supabase Storage
    const { data, error } = await supabase.storage
      .from('chat-files')
      .upload(fileName, req.file.buffer, {
        contentType: req.file.mimetype
      });

    if (error) {
      console.error('Error subiendo archivo:', error);
      return res.status(500).json({ 
        success: false, 
        message: 'Error subiendo archivo' 
      });
    }

    // Obtener URL pública
    const { data: publicUrl } = supabase.storage
      .from('chat-files')
      .getPublicUrl(fileName);

    res.json({
      success: true,
      fileUrl: publicUrl.publicUrl,
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
        console.error('Error guardando mensaje:', error);
        socket.emit('message_error', { error: 'Error guardando mensaje' });
        return;
      }

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
  socket.on('disconnect', async () => {
    console.log(`❌ Usuario desconectado: ${socket.userId}`);
    
    // Actualizar estado a offline en base de datos
    await supabase
      .from('usuarios')
      .update({ estado: 'offline' })
      .eq('id', socket.userId);
    
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
  if (!fecha) return 'Nunca';
  
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
  if (!fecha) return '';
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
    version: '1.0.2',
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
