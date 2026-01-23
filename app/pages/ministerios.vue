<template>
  <v-app>
    <v-app-bar 
      app 
      color="#041845"
      elevation="1" 
      height="70"
    >
      <v-container class="d-flex align-center">
        <LogoTitle />
        
        <!-- Desktop Menu -->
        <div class="d-none d-sm-flex align-center">
          <v-btn 
            :to="'/land'" 
            variant="text"
            class="mx-0 text-body-1"
            style="text-transform: none; color: white;"
          >
            Inicio
          </v-btn>
          <v-btn 
            href="/calendar" 
            variant="text"
            class="mx-0 text-body-1"
            style="text-transform: none; color: white;"
          >
            Eventos
          </v-btn>
          <v-btn 
            href="/ministerios" 
            variant="text"
            class="mx-0 text-body-1"
            style="text-transform: none; color: white;"
          >
            Ministerios
          </v-btn>
          <v-btn 
            @click="goToPage('/land#horarios')" 
            variant="text"
            class="mx-0 text-body-1"
            style="text-transform: none; color: white; cursor: pointer;"
          >
            Horarios
          </v-btn>
          <v-btn 
            @click="goToPage('/land#ubicacion')" 
            variant="text"
            class="mx-0 text-body-1"
            style="text-transform: none; color: white; cursor: pointer;"
          >
            Ubicación
          </v-btn>
          <v-divider vertical class="mx-4" style="border-color: rgba(255,255,255,0.3);"></v-divider>
          <v-btn 
            icon 
            variant="text" 
            href="https://www.facebook.com/IglesiaAvivamientoMonterrey" 
            target="_blank"
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
          :to="'/land'"
          style="color: white;"
        >
          <v-list-item-title>Inicio</v-list-item-title>
        </v-list-item>
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
          @click="goToSection('/land#horarios')"
          style="color: white; cursor: pointer;"
        >
          <v-list-item-title>Horarios</v-list-item-title>
        </v-list-item>
        <v-list-item
          @click="goToSection('/land#ubicacion')"
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

    <v-main class="bg-grey-lighten-4">
      <!-- Header Section -->
      <v-container class="py-16">
        <v-row justify="center">
          <v-col cols="12" md="10" lg="8" class="text-center">
            <p class="text-overline mb-2" style="color: #666; letter-spacing: 2px;">ÚNETE A NOSOTROS</p>
            <h1 class="text-h3 font-weight-light mb-4" style="color: #041845;">Nuestros Ministerios</h1>
            <p class="text-h6 font-weight-light" style="color: #555; line-height: 1.8;">
              Descubre cómo puedes servir y crecer en tu fe a través de nuestros diferentes ministerios
            </p>
          </v-col>
        </v-row>
      </v-container>

      <!-- Ministerios Grid -->
      <v-container class="pb-16">
        <v-row>
          <!-- Ministerio de Jóvenes -->
          <v-col cols="12" md="6" lg="4">
            <v-card 
              elevation="0" 
              class="ministerio-card h-100" 
              style="border: 1px solid #e0e0e0;"
              href="#jovenes"
            >
              <v-card-text class="pa-6">
                <div class="d-flex align-center mb-4">
                  <v-icon size="40" color="#041845" class="mr-3">mdi-account-group</v-icon>
                  <h3 class="text-h5 font-weight-regular" style="color: #041845;">Jóvenes</h3>
                </div>
                <p class="text-body-1 mb-4" style="color: #555; line-height: 1.8;">
                  Un espacio para la juventud donde encuentran propósito, comunidad y crecimiento espiritual.
                </p>
                <v-chip color="#041845" size="small" style="color: white;">
                  #jovenes
                </v-chip>
              </v-card-text>
            </v-card>
          </v-col>

          <!-- Ministerio de Matrimonios -->
          <v-col cols="12" md="6" lg="4">
            <v-card 
              elevation="0" 
              class="ministerio-card h-100" 
              style="border: 1px solid #e0e0e0;"
              href="#matrimonios"
            >
              <v-card-text class="pa-6">
                <div class="d-flex align-center mb-4">
                  <v-icon size="40" color="#041845" class="mr-3">mdi-heart-multiple</v-icon>
                  <h3 class="text-h5 font-weight-regular" style="color: #041845;">Matrimonios</h3>
                </div>
                <p class="text-body-1 mb-4" style="color: #555; line-height: 1.8;">
                  Fortaleciendo familias a través de la Palabra y el compañerismo entre parejas.
                </p>
                <v-chip color="#041845" size="small" style="color: white;">
                  #matrimonios
                </v-chip>
              </v-card-text>
            </v-card>
          </v-col>

          <!-- Ministerio de Evangelismo -->
          <v-col cols="12" md="6" lg="4">
            <v-card 
              elevation="0" 
              class="ministerio-card h-100" 
              style="border: 1px solid #e0e0e0;"
              href="#evangelismo"
            >
              <v-card-text class="pa-6">
                <div class="d-flex align-center mb-4">
                  <v-icon size="40" color="#041845" class="mr-3">mdi-bullhorn</v-icon>
                  <h3 class="text-h5 font-weight-regular" style="color: #041845;">Evangelismo</h3>
                </div>
                <p class="text-body-1 mb-4" style="color: #555; line-height: 1.8;">
                  Compartiendo el mensaje de esperanza y salvación en nuestra comunidad.
                </p>
                <v-chip color="#041845" size="small" style="color: white;">
                  #evangelismo
                </v-chip>
              </v-card-text>
            </v-card>
          </v-col>

          <!-- Ministerio EDIN -->
          <v-col cols="12" md="6" lg="4">
            <v-card 
              elevation="0" 
              class="ministerio-card h-100" 
              style="border: 1px solid #e0e0e0;"
              href="#edin"
            >
              <v-card-text class="pa-6">
                <div class="d-flex align-center mb-4">
                  <v-icon size="40" color="#041845" class="mr-3">mdi-school</v-icon>
                  <h3 class="text-h5 font-weight-regular" style="color: #041845;">EDIN</h3>
                </div>
                <p class="text-body-1 mb-4" style="color: #555; line-height: 1.8;">
                  Escuela de Integración para nuevos creyentes, formando discípulos comprometidos.
                </p>
                <v-chip color="#041845" size="small" style="color: white;">
                  #edin
                </v-chip>
              </v-card-text>
            </v-card>
          </v-col>

          <!-- Ministerio de Consolidación -->
          <v-col cols="12" md="6" lg="4">
            <v-card 
              elevation="0" 
              class="ministerio-card h-100" 
              style="border: 1px solid #e0e0e0;"
              href="#consolidacion"
            >
              <v-card-text class="pa-6">
                <div class="d-flex align-center mb-4">
                  <v-icon size="40" color="#041845" class="mr-3">mdi-hand-heart</v-icon>
                  <h3 class="text-h5 font-weight-regular" style="color: #041845;">Consolidación</h3>
                </div>
                <p class="text-body-1 mb-4" style="color: #555; line-height: 1.8;">
                  Acompañando y cuidando a cada persona en su caminar con Cristo.
                </p>
                <v-chip color="#041845" size="small" style="color: white;">
                  #consolidacion
                </v-chip>
              </v-card-text>
            </v-card>
          </v-col>

          <!-- Ministerio de Alabanza -->
          <v-col cols="12" md="6" lg="4">
            <v-card 
              elevation="0" 
              class="ministerio-card h-100" 
              style="border: 1px solid #e0e0e0;"
              href="#alabanza"
            >
              <v-card-text class="pa-6">
                <div class="d-flex align-center mb-4">
                  <v-icon size="40" color="#041845" class="mr-3">mdi-music</v-icon>
                  <h3 class="text-h5 font-weight-regular" style="color: #041845;">Alabanza</h3>
                </div>
                <p class="text-body-1 mb-4" style="color: #555; line-height: 1.8;">
                  Adorando a Dios con música y guiando a la congregación en adoración.
                </p>
                <v-chip color="#041845" size="small" style="color: white;">
                  #alabanza
                </v-chip>
              </v-card-text>
            </v-card>
          </v-col>
        </v-row>
      </v-container>

      <!-- Call to Action -->
      <v-container fluid class="py-16" style="background-color: #041845;">
        <v-container>
          <v-row justify="center">
            <v-col cols="12" md="8" class="text-center">
              <h2 class="text-h4 font-weight-light mb-6" style="color: white;">
                ¿Listo para servir?
              </h2>
              <p class="text-h6 font-weight-light mb-8" style="color: rgba(255,255,255,0.8);">
                Únete a uno de nuestros ministerios y marca la diferencia
              </p>
              <v-btn
                @click="goToPage('/land#contacto')"
                variant="flat"
                size="x-large"
                color="white"
                style="text-transform: none; color: #041845; cursor: pointer;"
                class="px-8"
              >
                Contáctanos
              </v-btn>
            </v-col>
          </v-row>
        </v-container>
      </v-container>
    </v-main>
  </v-app>
</template>

<script setup>
import { ref } from 'vue'

const drawer = ref(false)

const goToPage = (path) => {
  navigateTo(path)
}

const goToSection = (path) => {
  drawer.value = false
  navigateTo(path)
}

useHead({
  title: 'Ministerios - Avivamiento Monterrey',
  meta: [
    {
      name: 'description',
      content: 'Descubre los ministerios de la Iglesia Avivamiento Monterrey. Jóvenes, Matrimonios, Evangelismo, EDIN, Consolidación y más.'
    },
    {
      name: 'keywords',
      content: 'ministerios Avivamiento Monterrey, ministerio jóvenes, ministerio matrimonios, evangelismo Monterrey, EDIN, consolidación iglesia'
    }
  ]
})
</script>

<style scoped>
.ministerio-card {
  transition: transform 0.3s ease-in-out, box-shadow 0.3s ease-in-out;
  cursor: pointer;
}

.ministerio-card:hover {
  transform: translateY(-8px);
  box-shadow: 0 8px 24px rgba(0,0,0,0.12);
}

.h-100 {
  height: 100%;
}
</style>
