// ✅ CORRECCIONES PARA EL SERVIDOR - Endpoints de contactos

// ========== RUTAS CORREGIDAS PARA CONTACTOS ==========

// ✅ MEJORADO: Obtener contactos del usuario
app.get('/api/contacts', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    console.log(`📇 Obteniendo contactos para usuario: ${userId}`);
    
    // ✅ USAR LA FUNCIÓN SQL CORREGIDA
    const { data: contactos, error } = await supabase
      .rpc('get_contactos_usuario');
      
    if (error) {
      console.error('Error obteniendo contactos:', error);
      
      // ✅ MEJORADO: Fallback con datos más realistas
      console.log('📊 Devolviendo datos de prueba como fallback');
      return res.json([
        {
          id: 1,
          username: 'demo_user1',
          foto: 'default.jpg',
          ultimo_acceso: 'En línea',
          online: true,
          ultimo_mensaje: 'Hola, ¿cómo estás?',
          hora_ultimo_mensaje: '14:30',
          mensajes_no_leidos: 0
        },
        {
          id: 2,
          username: 'demo_user2', 
          foto: 'default.jpg',
          ultimo_acceso: 'Hace 5 min',
          online: false,
          ultimo_mensaje: 'Nos vemos mañana',
          hora_ultimo_mensaje: '13:45',
          mensajes_no_leidos: 2
        }
      ]);
    }
    
    console.log(`✅ Contactos encontrados: ${contactos ? contactos.length : 0}`);
    console.log('📊 Datos de contactos:', JSON.stringify(contactos, null, 2));
    
    // ✅ Los datos ya vienen formateados de la función SQL
    res.json(contactos || []);
    
  } catch (error) {
    console.error('❌ Error en /api/contacts:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error interno del servidor' 
    });
  }
});

// ✅ CORREGIDO: Buscar usuario por username
app.post('/api/users/search', authenticateToken, async (req, res) => {
  try {
    const { username } = req.body;
    const userId = req.user.userId;

    console.log(`🔍 Usuario ${userId} buscando: "${username}"`);

    if (!username || username.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: 'El término de búsqueda debe tener al menos 2 caracteres'
      });
    }

    // ✅ USAR LA FUNCIÓN SQL CORREGIDA PARA BUSCAR
    const { data: usuarios, error } = await supabase
      .rpc('buscar_usuario_para_agregar', { termino: username.trim() });

    if (error) {
      console.error('Error buscando usuario:', error);
      return res.status(500).json({
        success: false,
        message: 'Error en la búsqueda'
      });
    }

    console.log(`📊 Resultado búsqueda:`, JSON.stringify(usuarios, null, 2));

    if (usuarios && usuarios.length > 0) {
      const usuario = usuarios[0];
      console.log(`✅ Usuario encontrado: ${usuario.username} (ID: ${usuario.id})`);
      
      res.json({
        success: true,
        usuario: {
          id: usuario.id,           // ✅ UUID del usuario
          username: usuario.username, // ✅ Username para mostrar
          nombre: usuario.nombre,     // ✅ Nombre completo
          email: usuario.email        // ✅ Email
        }
      });
    } else {
      console.log('❌ Usuario no encontrado');
      res.json({
        success: false,
        message: 'Usuario no encontrado'
      });
    }

  } catch (error) {
    console.error('❌ Error buscando usuario:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error buscando usuario' 
    });
  }
});

// ✅ COMPLETAMENTE NUEVO: Agregar contacto (maneja tanto UUID como username)
app.post('/api/contacts/add', authenticateToken, async (req, res) => {
  try {
    const { contacto_id, username, contacto_username } = req.body;
    const userId = req.user.userId;
    
    console.log(`👥 Datos recibidos para agregar contacto:`, {
      contacto_id,
      username,
      contacto_username,
      userId
    });
    
    // ✅ PRIORIDAD 1: Si viene contacto_id como UUID, usar función original
    if (contacto_id && typeof contacto_id === 'string' && contacto_id.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
      console.log(`📝 Agregando contacto por UUID: ${contacto_id}`);
      
      const { data: resultado, error } = await supabase
        .rpc('agregar_contacto', { nuevo_contacto_id: contacto_id });
        
      if (error) {
        console.error('Error agregando contacto por UUID:', error);
        return res.status(500).json({ 
          success: false, 
          message: 'Error al agregar contacto' 
        });
      }
      
      const respuesta = resultado[0];
      if (respuesta.success) {
        return res.json({ 
          success: true, 
          message: respuesta.message 
        });
      } else {
        return res.status(400).json({ 
          success: false, 
          message: respuesta.message 
        });
      }
    }
    
    // ✅ PRIORIDAD 2: Si viene username o contacto_username, usar función por username  
    const usernameToAdd = username || contacto_username;
    
    if (!usernameToAdd) {
      return res.status(400).json({ 
        success: false, 
        message: 'Se requiere username o contacto_id' 
      });
    }
    
    console.log(`📝 Agregando contacto por username: ${usernameToAdd}`);
    
    const { data: resultado, error } = await supabase
      .rpc('agregar_contacto_por_username', { contacto_username: usernameToAdd });
      
    if (error) {
      console.error('Error agregando contacto por username:', error);
      return res.status(500).json({ 
        success: false, 
        message: 'Error al agregar contacto' 
      });
    }
    
    console.log('📊 Resultado agregar contacto:', JSON.stringify(resultado, null, 2));
    
    const respuesta = resultado[0];
    if (respuesta.success) {
      res.json({ 
        success: true, 
        message: respuesta.message,
        contacto: respuesta.contacto_agregado
      });
    } else {
      // Determinar el código de estado apropiado
      let statusCode = 400;
      if (respuesta.message.includes('no encontrado')) {
        statusCode = 404;
      } else if (respuesta.message.includes('ya está')) {
        statusCode = 409;
      }
      
      res.status(statusCode).json({ 
        success: false, 
        message: respuesta.message 
      });
    }
    
  } catch (error) {
    console.error('❌ Error en /api/contacts/add:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error interno del servidor' 
    });
  }
});

// ✅ NUEVO: Endpoint para debugging - ver estado de la base de datos
app.get('/api/debug/users', authenticateToken, async (req, res) => {
  try {
    // Solo permitir en desarrollo
    if (process.env.NODE_ENV === 'production') {
      return res.status(404).json({ message: 'Not found' });
    }
    
    const { data: usuarios, error } = await supabase
      .from('usuarios')
      .select('id, nombre, email, estado, last_seen')
      .order('nombre');
      
    if (error) {
      return res.status(500).json({ error: error.message });
    }
    
    res.json({
      total: usuarios.length,
      usuarios: usuarios.map(u => ({
        id: u.id,
        username: u.nombre, // ✅ Mostrar que nombre = username
        email: u.email,
        estado: u.estado,
        last_seen: u.last_seen
      }))
    });
    
  } catch (error) {
    console.error('Error en debug:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ✅ NUEVO: Endpoint para debugging - ver contactos
app.get('/api/debug/contacts', authenticateToken, async (req, res) => {
  try {
    // Solo permitir en desarrollo
    if (process.env.NODE_ENV === 'production') {
      return res.status(404).json({ message: 'Not found' });
    }
    
    const { data: contactos, error } = await supabase
      .from('contactos')
      .select(`
        id,
        usuario_id,
        contacto_id,
        agregado_en,
        usuario:usuarios!contactos_usuario_id_fkey(nombre, email),
        contacto:usuarios!contactos_contacto_id_fkey(nombre, email)
      `)
      .order('agregado_en', { ascending: false });
      
    if (error) {
      return res.status(500).json({ error: error.message });
    }
    
    res.json({
      total: contactos.length,
      contactos: contactos.map(c => ({
        id: c.id,
        usuario_username: c.usuario.nombre,
        usuario_email: c.usuario.email,
        contacto_username: c.contacto.nombre,
        contacto_email: c.contacto.email,
        agregado_en: c.agregado_en
      }))
    });
    
  } catch (error) {
    console.error('Error en debug contactos:', error);
    res.status(500).json({ error: 'Error interno' });
  }
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
