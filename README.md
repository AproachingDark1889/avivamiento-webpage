# Avivamiento Monterrey - Landing Page

Página web oficial de la Iglesia Avivamiento Monterrey, liderada por los Pastores **Adrian Aguirre** y **Sara Aguirre**.

## 🚀 Características

- ✅ Diseño moderno y responsive con **Vuetify 3**
- ✅ SEO optimizado para búsquedas de "Adrian Aguirre", "Sara Aguirre" y "Avivamiento Monterrey"
- ✅ Integración de **Google Maps**
- ✅ Información de horarios y contacto
- ✅ Construido con **Nuxt.js 3**

## 📋 Requisitos Importantes

⚠️ **IMPORTANTE:** Este proyecto requiere Node.js 18.x o 20.x

Si tienes Node.js 21.x, necesitas cambiar a la versión 20.x:

```bash
# Con nvm (recomendado)
nvm install 20
nvm use 20

# Verificar versión
node --version
```

## 🔧 Instalación

```bash
# Instalar dependencias
npm install

# Iniciar servidor de desarrollo
npm run dev

# El servidor estará disponible en http://localhost:3000
```

## 🌐 Compilar para Producción

```bash
# Compilar para producción
npm run build

# Generar sitio estático
npm run generate

# Vista previa de la versión de producción
npm run preview
```

## 📍 Información de la Iglesia

**Avivamiento Monterrey**
- **Pastores:** Adrian Aguirre y Sara Aguirre
- **Ubicación:** Monterrey, Nuevo León, México
- **Teléfono:** +52 (81) 1234-5678
- **Email:** info@avivamientomty.com

### Horarios de Culto

- **Domingo:** 10:00 AM - Culto General
- **Miércoles:** 7:00 PM - Reunión de Oración
- **Viernes:** 7:30 PM - Culto Juvenil

## 🛠️ Tecnologías Utilizadas

- **Nuxt.js 3** - Framework Vue.js para aplicaciones modernas
- **Vuetify 3** - Framework de componentes Material Design
- **Vue 3** - Framework JavaScript progresivo
- **Material Design Icons** - Iconografía completa
- **Google Maps** - Integración de mapas

## 📝 Estructura del Proyecto

```
avivamiento_webpage/
├── app.vue              # Componente principal con toda la landing page
├── nuxt.config.ts       # Configuración de Nuxt y SEO
├── plugins/
│   └── vuetify.ts      # Configuración de Vuetify y tema
├── package.json         # Dependencias del proyecto
└── README.md           # Este archivo
```

## 🎨 Personalización

### Actualizar Información de Contacto

Edita el archivo `app.vue` y busca las siguientes secciones:

1. **Teléfono:** Busca `+52 (81) 1234-5678`
2. **Email:** Busca `info@avivamientomty.com`
3. **Dirección:** Actualiza la ubicación en la sección de Google Maps

### Actualizar Google Maps

En `app.vue`, busca el `iframe` y reemplaza la URL con las coordenadas exactas de tu iglesia:

```html
<iframe
  src="TU_URL_DE_GOOGLE_MAPS_AQUI"
  ...
></iframe>
```

Para obtener tu URL de Google Maps:
1. Ve a [Google Maps](https://maps.google.com)
2. Busca tu iglesia o dirección
3. Clic en "Compartir" → "Insertar un mapa"
4. Copia el `src` del iframe

### Cambiar Colores del Tema

Edita `plugins/vuetify.ts` para cambiar los colores:

```javascript
colors: {
  primary: '#1976D2',  // Cambia este color
  secondary: '#424242',
  // ...
}
```

### Actualizar Meta Tags SEO

Edita `nuxt.config.ts` para modificar:
- Título de la página
- Descripción
- Keywords
- Open Graph tags

## 📱 SEO y Palabras Clave

La página está optimizada para ser encontrada por los motores de búsqueda con:

- **Nombres de Pastores:** Adrian Aguirre, Sara Aguirre, Pastor Adrian Aguirre, Pastora Sara Aguirre
- **Nombre de la Iglesia:** Avivamiento Monterrey, Iglesia Avivamiento Monterrey
- **Ubicación:** Monterrey, Nuevo León, iglesia Monterrey
- **Términos Generales:** iglesia cristiana, cultos Monterrey

## 🐛 Solución de Problemas

### Error: module.createRequire is not a function

Este error ocurre con Node.js 21.x. Solución:

```bash
# Instalar Node.js 20.x con nvm
nvm install 20
nvm use 20

# Limpiar e instalar de nuevo
rm -rf node_modules package-lock.json
npm install
npm run dev
```

### Puerto 3000 ocupado

Si el puerto 3000 está en uso:

```bash
npm run dev -- --port 3001
```

## 📄 Licencia

© 2025 Avivamiento Monterrey - Todos los derechos reservados

---

**Desarrollado con ❤️ para la Iglesia Avivamiento Monterrey**
