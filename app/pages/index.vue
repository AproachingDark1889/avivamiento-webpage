<template>
  <v-app>
    <v-app-bar 
      app 
      :color="scrolled ? '#041845' : 'transparent'"
      :elevation="scrolled ? 1 : 0" 
      height="70" 
      :style="scrolled ? 'border-bottom: 1px solid rgba(255,255,255,0.1);' : ''"
      class="navbar-transition"
      flat
    >
      <v-container class="d-flex align-center">
       <LogoTitle />

        
        <!-- Desktop Menu -->
        <div class="d-none d-sm-flex align-center">
        <v-btn 
          href="/calendar" 
          variant="text"
          class="mx-0 px-3  text-body-1"
          style="text-transform: none; color: white;"
        >
          Eventos
        </v-btn>
        <v-btn 
          href="/ministerios" 
          variant="text"
          class="mx-0 px-3  text-body-1"
          style="text-transform: none; color: white;"
        >
          Ministerios
        </v-btn>
        <v-btn 
          @click="scrollToSection('horarios')" 
          variant="text"
          class="mx-0 px-3 text-body-1"
          style="text-transform: none; color: white; cursor: pointer;"
        >
          Horarios
        </v-btn>
        <v-btn 
          @click="scrollToSection('ubicacion')" 
          variant="text"
          class="mx-0 px-3 text-body-1"
          style="text-transform: none; color: white; cursor: pointer;"
        >
          Ubicación
        </v-btn>
        <v-divider vertical class="mx-2" style="border-color: rgba(255,255,255,0.3);"></v-divider>
        <v-btn 
          icon 
          variant="text" 
          href="https://www.facebook.com/IglesiaAvivamientoMonterrey" 
          target="_blank"
          size="default"
          style="color: white;"
        >
          <v-icon size="24">mdi-facebook</v-icon>
        </v-btn>
        <v-btn 
          icon 
          variant="text" 
          href="https://www.instagram.com/avivamientomonterrey/" 
          target="_blank"
        
          style="color: white;"
        >
          <v-icon size="24">mdi-instagram</v-icon>
        </v-btn>
        <v-btn 
          icon 
          variant="text" 
          href="https://www.tiktok.com/@avivamientomonterrey" 
          target="_blank"
         
          style="color: white;"
        >
          <v-icon size="24">mdi-music-note</v-icon>
        </v-btn>
        <v-btn 
          icon 
          variant="text" 
          href="https://open.spotify.com/show/3BlpJIaQRraIURcanH5rg1" 
          target="_blank"
         
          style="color: white;"
        >
          <v-icon size="24">mdi-spotify</v-icon>
        </v-btn>
        </div>
        
        <!-- Mobile Menu Button -->
        <v-btn 
          icon 
          variant="text"
          class="d-sm-none"
          style="color: white;"
          @click="drawer = !drawer"
        >
          <v-icon>mdi-menu</v-icon>
        </v-btn>
      </v-container>
    </v-app-bar>

    <!-- Mobile Navigation Drawer -->
    <v-navigation-drawer
      v-model="drawer"
      temporary
      location="right"
      style="background-color: #041845;"
    >
      <v-list style="background-color: #041845;">
        <v-list-item
          href="/calendar"
          style="color: white;"
        >
          <v-list-item-title>Eventos</v-list-item-title>
        </v-list-item>
        <v-list-item
          href="/ministerios"
          style="color: white;"
        >
          <v-list-item-title>Ministerios</v-list-item-title>
        </v-list-item>
        <v-list-item
          @click="drawer = false; scrollToSection('horarios')"
          style="color: white; cursor: pointer;"
        >
          <v-list-item-title>Horarios</v-list-item-title>
        </v-list-item>
        <v-list-item
          @click="drawer = false; scrollToSection('ubicacion')"
          style="color: white; cursor: pointer;"
        >
          <v-list-item-title>Ubicación</v-list-item-title>
        </v-list-item>
        <v-divider class="my-4" style="border-color: rgba(255,255,255,0.3);"></v-divider>
        <v-list-item
          href="https://www.facebook.com/IglesiaAvivamientoMonterrey"
          target="_blank"
          style="color: white;"
        >
          <template v-slot:prepend>
            <v-icon>mdi-facebook</v-icon>
          </template>
          <v-list-item-title>Facebook</v-list-item-title>
        </v-list-item>
        <v-list-item
          href="https://www.instagram.com/avivamientomonterrey/"
          target="_blank"
          style="color: white;"
        >
          <template v-slot:prepend>
            <v-icon>mdi-instagram</v-icon>
          </template>
          <v-list-item-title>Instagram</v-list-item-title>
        </v-list-item>
        <v-list-item
          href="https://www.tiktok.com/@avivamientomonterrey"
          target="_blank"
          style="color: white;"
        >
          <template v-slot:prepend>
            <v-icon>mdi-music-note</v-icon>
          </template>
          <v-list-item-title>TikTok</v-list-item-title>
        </v-list-item>
        <v-list-item
          href="https://open.spotify.com/show/3BlpJIaQRraIURcanH5rg1"
          target="_blank"
          style="color: white;"
        >
          <template v-slot:prepend>
            <v-icon>mdi-spotify</v-icon>
          </template>
          <v-list-item-title>Spotify</v-list-item-title>
        </v-list-item>
      </v-list>
    </v-navigation-drawer>

    <v-main class="pa-0">
      <!-- Hero Section -->
      <v-container fluid class="hero-section pa-0" style="margin-top: -70px;">
        <v-img
          src="/images/poster2.webp"
          alt="Iglesia Avivamiento Monterrey - Pastor Adrian Aguirre"
          :height="heroHeight"
          cover
          :position="isMobile ? 'center center' : 'center center'"
        > 
        </v-img>
        <!-- Debug info -->
        <!-- <div v-if="isMobile" style="background: rgba(0,0,0,0.7); color: white; padding: 8px; text-align: center; font-size: 12px;">
          Aspect Ratio: {{ (width / height).toFixed(2) }} | Width: {{ width }}px | Height: {{ height }}px | Hero: {{ heroHeight }}
        </div> -->
      </v-container>

      <!-- Pastores Section -->
      <v-container class="py-4">
        <v-row>
          <v-col cols="12" class="text-center mb-1">
            <p class="text-overline mb-2" style="color: #666; letter-spacing: 2px;">LIDERAZGO</p>
            <h2 class="text-h3 font-weight-light" style="color: #041845;">Nuestros Pastores</h2>
          </v-col>
        </v-row>
        <v-row justify="center">
          <v-col cols="12" md="5">
            <v-card elevation="0" class="text-center pa-4" style="border: 1px solid #e0e0e0;">
              <v-avatar size="180" class="mb-2">
                <v-img src="/images/pastor_adrian.webp" alt="Pastor Adrian Aguirre"></v-img>
              </v-avatar>
              <h3 class="text-h5 font-weight-regular " style="color: #041845;">Adrian Aguirre</h3>
              <p class="text-body-2 text-grey mb-2" style="text-transform: uppercase; letter-spacing: 1px;">Pastor Principal</p>
              <p class="text-body-1" style="color: #555; line-height: 1.8;">
                Sirviendo con pasión y dedicación en el ministerio, guiando a la congregación con amor y sabiduría.
              </p>
            </v-card>
          </v-col>
          <v-col cols="12" md="5">
            <v-card elevation="0" class="text-center pa-4" style="border: 1px solid #e0e0e0;">
              <v-avatar size="180" class="mb-2">
                <v-img src="/images/pastora_sara.webp" alt="Pastora Sara Aguirre"></v-img>
              </v-avatar>
              <h3 class="text-h5 font-weight-regular" style="color: #041845;">Sara Aguirre</h3>
              <p class="text-body-2 text-grey  mb-2" style="text-transform: uppercase; letter-spacing: 1px;">Co-Pastora</p>
              <p class="text-body-1" style="color: #555; line-height: 1.8;">
                Comprometida con el cuidado y edificación de las familias, ministrando con gracia y compasión.
              </p>
            </v-card>
          </v-col>
        </v-row>
      </v-container>

      <!-- Horarios Section -->
      <v-container fluid id="horarios" class="py-4" style="background-color: #f8f9fa;">
        <v-container>
          <v-row>
            <v-col cols="12" class="text-center">
              <p class="text-overline mb-2" style="color: #666; letter-spacing: 2px;">REUNIONES</p>
              <h2 class="text-h3 font-weight-light " style="color: #041845;">Horarios de Culto</h2>
            </v-col>
          </v-row>
          <v-row justify="center">
            <v-col cols="12" md="6">
              <v-card class="text-center pa-3" elevation="0" style="background-color: white; border: 1px solid #e0e0e0;">
                <h3 class="text-h5 font-weight-light mb-4" style="color: #041845;">Domingo</h3>
                <p class="text-h6 mb-2" style="color: #555;">11:00 AM</p>
                <p class="text-body-2" style="color: #888;">Reunión General</p>
              </v-card>
            </v-col>
            <v-col cols="12" md="6">
              <v-card class="text-center pa-3" elevation="0" style="background-color: white; border: 1px solid #e0e0e0;">
                <h3 class="text-h5 font-weight-light mb-4" style="color: #041845;">Miércoles</h3>
                <p class="text-h6 mb-2" style="color: #555;">8:00 PM</p>
                <p class="text-body-2" style="color: #888;">Reunión General</p>
              </v-card>
            </v-col>
       
          </v-row>
        </v-container>
      </v-container>

      <!-- Ubicación y Mapa Section -->
      <v-container id="ubicacion" class="py-4">
        <v-row>
          <v-col cols="12" class="text-center">
            <p class="text-overline mb-2" style="color: #666; letter-spacing: 2px;">ENCÚENTRANOS</p>
            <h2 class="text-h3 font-weight-light" style="color: #041845;">Ubicación</h2>
          </v-col>
        </v-row>
        <v-row>
          <v-col cols="12" md="5">
            <div class="pa-4">
              <h3 class="text-h5 font-weight-light mb-1" style="color: #041845;">Iglesia Avivamiento Monterrey</h3>
              
              <div class="mb-6">
                <p class="text-overline mb-2" style="color: #888;">DIRECCIÓN</p>
                <p class="text-body-1" style="color: #555;">
                  Av. Santo Domingo #215, Col. Mezquital, Apodaca, México
                </p>
              </div>

              <div class="mb-6">
                <p class="text-overline mb-2" style="color: #888;">TELÉFONO</p>
                <p class="text-body-1">
                  <a href="tel:+528111651800" class="text-decoration-none" style="color: #041845;">
                    +52 (81) 1165-1800
                  </a>
                </p>
              </div>

              <div class="mb-8">
                <p class="text-overline mb-2" style="color: #888;">EMAIL</p>
                <p class="text-body-1">
                  <a href="mailto:info@avivamientomty.com" class="text-decoration-none" style="color: #041845;">
                    elavivamientomonterrey@hotmail.com
                  </a>
                </p>
              </div>

              <v-btn
                href="https://maps.app.goo.gl/g7wBuXmhKL114A657"
                target="_blank"
                color="#041845"
                variant="flat"
                size="large"
                block
                class="mt-4"
                style="text-transform: none;"
              >
                Abrir en Google Maps
              </v-btn>
            </div>
          </v-col>
          <v-col cols="12" md="6">
            <v-card elevation="0" height="100%" style="border: 1px solid #e0e0e0;">
              <iframe
                src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3593.758495!2d-100.26967182250972!3d25.746658632809236!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x8662eb6f3a8a27ad%3A0xccd96829e38e7212!2sAVIVAMIENTO%20MONTERREY!5e0!3m2!1ses!2smx!4v1763651018410!5m2!1ses!2smx"
                width="100%"
                height="100%"
                style="border:0; min-height: 500px;"
                allowfullscreen=""
                loading="lazy"
                referrerpolicy="no-referrer-when-downgrade"
              ></iframe>
            </v-card>
          </v-col>
        </v-row>
      </v-container>

      <!-- Contacto Section -->
      <v-container fluid id="contacto" class="py-4" style="background-color: #041845;">
        <v-container>
          <v-row justify="center">
            <v-col cols="12" md="8" class="text-center">
              <p class="text-overline mb-4" style="color: rgba(255,255,255,0.7); letter-spacing: 2px;">BIENVENIDOS</p>
              <h2 class="text-h3 font-weight-light mb-6" style="color: white;">
                Únete a Nuestra Comunidad
              </h2>
              <p class="text-h6 font-weight-light mb-8" style="color: rgba(255,255,255,0.8);">
                Te invitamos a ser parte de nuestra familia en Cristo
              </p>
              <div class="d-flex flex-wrap justify-center gap-4">
                <v-btn
                  @click="scrollToSection('horarios')"
                  variant="outlined"
                  size="x-large"
                  color="white"
                  style="text-transform: none; cursor: pointer;"
                  class="px-8"
                >
                  Ver Horarios
                </v-btn>
                <v-btn
                  @click="scrollToSection('ubicacion')"
                  variant="flat"
                  size="x-large"
                  color="white"
                  style="text-transform: none; color: #041845; cursor: pointer;"
                  class="px-8"
                >
                  Cómo Llegar
                </v-btn>
              </div>
            </v-col>
          </v-row>
        </v-container>
      </v-container>
    </v-main>

    <!-- Footer -->
    <v-footer style="background-color: #1a1a1a; color: white;" class="py-4">
      <v-container>
        <v-row>
          <v-col cols="12" md="4" class="text-center text-md-left mb-6 mb-md-0">
            <h3 class="text-h5 font-weight-light mb-4" style="color: white;">Avivamiento Monterrey</h3>
            <p class="text-body-2" style="color: rgba(255,255,255,0.7); line-height: 1.8;">
              Una iglesia cristiana comprometida<br>
              con la comunidad de Monterrey
            </p>
          </v-col>
          <v-col cols="12" md="4" class="text-center mb-6 mb-md-0">
            <h3 class="text-overline mb-4" style="color: rgba(255,255,255,0.7); letter-spacing: 2px;">SÍGUENOS</h3>
            <div class="d-flex justify-center">
              <v-btn 
                icon 
                variant="text" 
                href="https://www.facebook.com/IglesiaAvivamientoMonterrey" 
                target="_blank" 
                class="mx-2"
                style="color: rgba(255,255,255,0.7);"
              >
                <v-icon size="28">mdi-facebook</v-icon>
              </v-btn>
              <v-btn 
                icon 
                variant="text" 
                href="https://www.instagram.com/avivamientomonterrey/" 
                target="_blank" 
                class="mx-2"
                style="color: rgba(255,255,255,0.7);"
              >
                <v-icon size="28">mdi-instagram</v-icon>
              </v-btn>
              <v-btn 
                icon 
                variant="text" 
                href="https://www.tiktok.com/@avivamientomonterrey" 
                target="_blank" 
                class="mx-2"
                style="color: rgba(255,255,255,0.7);"
              >
                <v-icon size="28">mdi-music-note</v-icon>
              </v-btn>
              <v-btn 
                icon 
                variant="text" 
                href="https://open.spotify.com/show/3BlpJIaQRraIURcanH5rg1" 
                target="_blank" 
                class="mx-2"
                style="color: rgba(255,255,255,0.7);"
              >
                <v-icon size="28">mdi-spotify</v-icon>
              </v-btn>
            </div>
          </v-col>
          <v-col cols="12" md="4" class="text-center text-md-right">
            <h3 class="text-overline mb-4" style="color: rgba(255,255,255,0.7); letter-spacing: 2px;">CONTACTO</h3>
            <p class="text-body-2 mb-2" style="color: rgba(255,255,255,0.7);">
              +52 (81) 1165-1800
            </p>
            <p class="text-body-2" style="color: rgba(255,255,255,0.7);">
              info@avivamientomty.com
            </p>
          </v-col>
        </v-row>
        <v-divider class="my-6" style="border-color: rgba(255,255,255,0.1);"></v-divider>
        <v-row>
          <v-col cols="12" class="text-center">
            <p class="text-body-2" style="color: rgba(255,255,255,0.5);">
              © {{ new Date().getFullYear() }} Avivamiento Monterrey - Todos los derechos reservados
            </p>
          </v-col>
        </v-row>
      </v-container>
    </v-footer>

    <!-- WhatsApp Floating Button -->
    <v-btn
      icon
      color="green"
      class="whatsapp-fab"
      style="position: fixed; bottom: 32px; right: 32px; z-index: 9999; box-shadow: 0 4px 16px rgba(0,0,0,0.2); width: 72px; height: 72px; min-width: 72px; min-height: 72px; border-radius: 50%;"
      :href="'https://wa.me/528111651800?text=Hola!%20Quiero%20más%20información%20sobre%20Avivamiento%20Monterrey'"
      target="_blank"
      @click="trackWhatsAppClick"
    >
      <v-icon size="48">mdi-whatsapp</v-icon>
    </v-btn>
  </v-app>
</template>

<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useDisplay } from 'vuetify'

// SEO Meta tags - debe ejecutarse primero para SSR/prerender
useHead({
  title: 'Pastor Adrian Aguirre | Avivamiento Monterrey | Iglesia Cristiana en Apodaca',
  link: [
    { rel: 'canonical', href: 'https://avivamientomonterrey.com/' }
  ],
  script: [
    {
      type: 'application/ld+json',
      children: JSON.stringify({
        '@context': 'https://schema.org',
        '@graph': [
          {
            '@type': 'Church',
            name: 'Iglesia Avivamiento Monterrey',
            description: 'Iglesia cristiana evangélica dirigida por el Pastor Adrian Aguirre',
            address: {
              '@type': 'PostalAddress',
              streetAddress: 'Av. Santo Domingo #215, Col. Mezquital',
              addressLocality: 'Apodaca',
              addressRegion: 'Nuevo León',
              postalCode: '66648',
              addressCountry: 'MX'
            },
            telephone: '+52-81-1165-1800',
            email: 'elavivamientomonterrey@hotmail.com',
            url: 'https://avivamientomonterrey.com',
            sameAs: [
              'https://www.facebook.com/IglesiaAvivamientoMonterrey',
              'https://www.instagram.com/avivamientomonterrey/',
              'https://www.tiktok.com/@avivamientomonterrey',
              'https://open.spotify.com/show/3BlpJIaQRraIURcanH5rg1'
            ],
            openingHours: ['Su 11:00-13:00', 'We 20:00-22:00'],
            geo: {
              '@type': 'GeoCoordinates',
              latitude: '25.7729',
              longitude: '-100.1868'
            }
          },
          {
            '@type': 'Person',
            name: 'Adrian Aguirre',
            jobTitle: 'Pastor Principal',
            worksFor: {
              '@type': 'Church',
              name: 'Iglesia Avivamiento Monterrey'
            }
          },
          {
            '@type': 'Person',
            name: 'Sara Aguirre',
            jobTitle: 'Pastora',
            worksFor: {
              '@type': 'Church',
              name: 'Iglesia Avivamiento Monterrey'
            }
          }
        ]
      })
    }
  ]
})

// useSeoMeta es más optimizado para SSR que meta en useHead
useSeoMeta({
  description: 'Iglesia Avivamiento Monterrey bajo el liderazgo del Pastor Adrian Aguirre y la Pastora Sara Aguirre. Ubicados en Apodaca, Monterrey. Cultos dominicales 11:00 AM. ¡Te esperamos!',
  keywords: 'Adrian Aguirre, Pastor Adrian Aguirre Monterrey, Sara Aguirre, Pastora Sara Aguirre, Avivamiento Monterrey, iglesia Apodaca, iglesia Mezquital Apodaca, cultos cristianos Monterrey, iglesia evangélica Nuevo León',
  ogTitle: 'Pastor Adrian Aguirre | Avivamiento Monterrey',
  ogDescription: 'Iglesia cristiana en Apodaca dirigida por Pastor Adrian Aguirre',
  ogUrl: 'https://avivamientomonterrey.com/',
  ogImage: 'https://avivamientomonterrey.com/images/poster2.webp',
  ogType: 'website',
  ogLocale: 'es_MX',
  twitterCard: 'summary_large_image',
  twitterTitle: 'Pastor Adrian Aguirre | Avivamiento Monterrey',
  twitterDescription: 'Iglesia cristiana en Apodaca dirigida por Pastor Adrian Aguirre',
  twitterImage: 'https://avivamientomonterrey.com/images/poster2.webp'
})

const drawer = ref(false)
const scrolled = ref(false)
const { mobile, width, height } = useDisplay()
const isMobile = computed(() => mobile.value)

// Altura dinámica basada en la proporción de la pantalla
const heroHeight = computed(() => {
  if (!isMobile.value) return 'calc(100vh + 70px)'
  // Calcular aspect ratio (ancho/alto)
  const aspectRatio = width.value / height.value
  // 360x880 = 0.41 | 360x800 = 0.45 | 320x568 = 0.56
  // Mientras más bajo el ratio (más alargada la pantalla), menor altura
  if (aspectRatio <= 0.43) return '40vh'  // Galaxy Z Flip y similares
  if (aspectRatio <= 0.5) return '45vh'   // 360x800
  if (aspectRatio <= 0.7) return '55vh'
  return '65vh'                           // 320x568 y más cuadradas
})

const handleScroll = () => {
  scrolled.value = window.scrollY > 100
}

const scrollToSection = (sectionId) => {
  const element = document.getElementById(sectionId)
  if (element) {
    const offset = 40
    const elementPosition = element.getBoundingClientRect().top
    const offsetPosition = elementPosition + window.pageYOffset - offset
    
    window.scrollTo({
      top: offsetPosition,
      behavior: 'smooth'
    })
  }
}

// Función para rastrear eventos en Google Tag Manager
const trackEvent = (eventName, eventParams = {}) => {
  if (typeof window !== 'undefined' && window.dataLayer) {
    window.dataLayer.push({
      event: eventName,
      ...eventParams
    })
  }
}

// Rastrear click en WhatsApp
const trackWhatsAppClick = () => {
  trackEvent('whatsapp_click', {
    event_category: 'engagement',
    event_label: 'WhatsApp Contact Button',
    value: 1
  })
}

// Inicializar scrolled inmediatamente
if (typeof window !== 'undefined') {
  scrolled.value = window.scrollY > 100
}

onMounted(() => {
  handleScroll()
  window.addEventListener('scroll', handleScroll)
  
  // Handle hash navigation on mount
  if (window.location.hash) {
    setTimeout(() => {
      const sectionId = window.location.hash.substring(1)
      scrollToSection(sectionId)
    }, 100)
  }
})

onUnmounted(() => {
  window.removeEventListener('scroll', handleScroll)
})
</script>

<style scoped>
.hero-section {
  position: relative;
}

.navbar-transition {
  transition: background-color 0.3s ease, box-shadow 0.3s ease;
}

.v-app-bar.bg-transparent {
  background-color: transparent !important;
}

.v-app-bar.bg-transparent .v-toolbar__content {
  background-color: transparent !important;
}

:deep(.v-application) {
  background: transparent !important;
  overflow-x: hidden !important;
  max-width: 100vw !important;
}

:deep(.v-application__wrap) {
  background: transparent !important;
  overflow-x: hidden !important;
  max-width: 100vw !important;
}

:deep(.v-main) {
  overflow-x: hidden !important;
  max-width: 100vw !important;
}

:deep(.v-container) {
  max-width: 100% !important;
}

:deep(.v-container.v-container--fluid) {
  padding-left: 0 !important;
  padding-right: 0 !important;
}

.v-card {
  transition: transform 0.3s ease-in-out;
}

.v-card:hover {
  transform: translateY(-8px);
}

a {
  color: inherit;
}

a:hover {
  color: #1976D2;
}

.whatsapp-fab {
  animation: whatsapp-fab-in 0.5s;
  /* Aumentar el tamaño del ícono y el botón */
  font-size: 2.5rem;
  width: 72px;
  height: 72px;
  min-width: 72px;
  min-height: 72px;
  border-radius: 50%;
}
@media (max-width: 600px) {
  .whatsapp-fab {
    width: 54px !important;
    height: 54px !important;
    min-width: 54px !important;
    min-height: 54px !important;
  }
  .whatsapp-fab .v-icon {
    font-size: 32px !important;
  }
}
@keyframes whatsapp-fab-in {
  from { opacity: 0; transform: scale(0.7);}
  to { opacity: 1; transform: scale(1);}
}
</style>
