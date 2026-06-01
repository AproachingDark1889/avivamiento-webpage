<template>
  <v-app>
    <!-- Desktop Sidebar -->
    <v-navigation-drawer
      :model-value="$vuetify.display.mdAndUp"
      :permanent="$vuetify.display.mdAndUp"
      app
      color="primary"
      width="260"
    >
      <div class="d-flex align-center pa-6">
        <v-icon icon="mdi-check-decagram" color="secondary" size="32" class="mr-3" />
        <div>
          <div class="text-h6 font-weight-black text-white" style="line-height: 1;">
            AVIVA
          </div>
          <div class="text-caption text-secondary font-weight-bold" style="letter-spacing: 2px;">
            CHECK
          </div>
        </div>
      </div>

      <v-divider color="white" class="mb-2" style="opacity: 0.15;" />

      <v-list nav density="comfortable">
        <v-list-item to="/page/POS" color="secondary" rounded="lg" class="mb-1">
          <template #prepend>
            <v-icon icon="mdi-view-dashboard-outline" />
          </template>
          <v-list-item-title class="font-weight-bold">Sistema</v-list-item-title>
        </v-list-item>

        <v-list-subheader class="text-uppercase font-weight-bold text-caption mt-4 mb-1" style="color: rgba(255,255,255,0.5);">Operación</v-list-subheader>

        <v-list-item to="/page/POS/pointOfSales" color="secondary" rounded="lg" class="mb-1">
          <template #prepend>
            <v-icon icon="mdi-point-of-sale" />
          </template>
          <v-list-item-title class="font-weight-bold">Caja </v-list-item-title>
        </v-list-item>

        <v-list-item to="/page/POS/kds" color="secondary" rounded="lg" class="mb-1">
          <template #prepend>
            <v-icon icon="mdi-chef-hat" />
          </template>
          <v-list-item-title class="font-weight-bold">Cocina</v-list-item-title>
        </v-list-item>

        <v-list-item to="/page/POS/cashClosing" color="secondary" rounded="lg" class="mb-1">
          <template #prepend>
            <v-icon icon="mdi-cash-register" />
          </template>
          <v-list-item-title class="font-weight-bold">Corte de Caja</v-list-item-title>
        </v-list-item>

        <v-list-subheader class="text-uppercase font-weight-bold text-caption mt-4 mb-1" style="color: rgba(255,255,255,0.5);">Gestión</v-list-subheader>
        
        <v-list-item to="/page/POS/products" color="secondary" rounded="lg" class="mb-1">
          <template #prepend>
            <v-icon icon="mdi-food" />
          </template>
          <v-list-item-title class="font-weight-bold">Productos</v-list-item-title>
        </v-list-item>

        <v-list-item to="/page/POS/reports" color="secondary" rounded="lg" class="mb-1">
          <template #prepend>
            <v-icon icon="mdi-chart-line" />
          </template>
          <v-list-item-title class="font-weight-bold">Reportes</v-list-item-title>
        </v-list-item>

        <v-list-item to="/page/POS/users" color="secondary" rounded="lg" class="mb-1">
          <template #prepend>
            <v-icon icon="mdi-account-group-outline" />
          </template>
          <v-list-item-title class="font-weight-bold">Usuarios</v-list-item-title>
        </v-list-item>
      </v-list>

      <template #append>
        <div class="pa-4">
          <v-card variant="tonal" class="pa-3 mb-3 bg-white" style="background-color: rgba(255,255,255,0.05) !important;">
            <div class="d-flex align-center">
              <v-avatar color="secondary" size="32" class="mr-3">
                <span class="text-primary font-weight-black">{{ userInitials }}</span>
              </v-avatar>
              <div style="overflow: hidden;">
                <div class="text-body-2 font-weight-bold text-white text-truncate">
                  {{ userName }}
                </div>
                <div class="text-caption text-secondary font-weight-bold text-uppercase" style="font-size: 10px;">
                  {{ userRole }}
                </div>
              </div>
            </div>
          </v-card>
          <v-btn block color="error" variant="text" prepend-icon="mdi-logout" @click="logout" rounded="lg">
            Cerrar Sesión
          </v-btn>
        </div>
      </template>
    </v-navigation-drawer>

    <!-- Mobile Top Bar -->
    <v-app-bar v-if="$vuetify.display.smAndDown" color="primary" density="compact" elevation="0">
      <v-icon icon="mdi-check-decagram" color="secondary" class="ml-3 mr-2" />
      <v-toolbar-title class="font-weight-black text-subtitle-1">
        AVIVA CHECK
      </v-toolbar-title>
      <v-spacer></v-spacer>
      <v-btn icon="mdi-logout" size="small" @click="logout" color="white"></v-btn>
    </v-app-bar>

    <v-main class="bg-surface">
      <slot />
    </v-main>

    <!-- Mobile Bottom Navigation -->
    <v-bottom-navigation
      v-if="$vuetify.display.smAndDown"
      :model-value="activeBottomNav"
      color="secondary"
      bg-color="primary"
      grow
    >
      <v-btn to="/page/POS/pointOfSales" value="pos">
        <v-icon>mdi-point-of-sale</v-icon>
        <span>Caja</span>
      </v-btn>
      <v-btn to="/page/POS/kds" value="kds">
        <v-icon>mdi-chef-hat</v-icon>
        <span>Cocina</span>
      </v-btn>
      <v-btn to="/page/POS/cashClosing" value="corte">
        <v-icon>mdi-cash</v-icon>
        <span>Corte</span>
      </v-btn>
       <v-menu location="top center">
        <template v-slot:activator="{ props }">
          <v-btn v-bind="props" value="more">
            <v-icon>mdi-dots-horizontal</v-icon>
            <span>Más</span>
          </v-btn>
        </template>
        <v-list density="compact" rounded="lg" elevation="4">
          <v-list-item to="/page/POS" title="Inicio" prepend-icon="mdi-home"></v-list-item>
          <v-list-item to="/page/POS/products" title="Productos" prepend-icon="mdi-food"></v-list-item>
          <v-list-item to="/page/POS/reports" title="Reportes" prepend-icon="mdi-chart-line"></v-list-item>
          <v-list-item to="/page/POS/users" title="Usuarios" prepend-icon="mdi-account-group"></v-list-item>
        </v-list>
      </v-menu>
    </v-bottom-navigation>

    <v-snackbar
      v-model="toast.show.value"
      :color="toast.color.value"
      timeout="3000"
      location="top center"
      variant="elevated"
      elevation="6"
      class="mt-4"
    >
      <div class="d-flex align-center">
        <v-icon :icon="toast.color.value === 'success' ? 'mdi-check-circle' : toast.color.value === 'error' ? 'mdi-alert-circle' : 'mdi-information'" class="mr-3" />
        <span class="font-weight-bold text-body-1">{{ toast.message }}</span>
      </div>
      <template v-slot:actions>
        <v-btn icon="mdi-close" size="small" variant="text" @click="toast.show = false" />
      </template>
    </v-snackbar>
  </v-app>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useAuthStore } from '../stores/auth'
import { useToast } from '../composables/useToast'
import { useRouter, useRoute } from 'vue-router'

const auth = useAuthStore()
const toast = useToast()
const router = useRouter()
const route = useRoute()

const activeBottomNav = computed(() => {
  if (route.path.includes('/pointOfSales')) return 'pos'
  if (route.path.includes('/kds')) return 'kds'
  if (route.path.includes('/cashClosing')) return 'corte'
  return 'more'
})

const userName = computed(() => auth.profile?.display_name || auth.user?.email || 'Usuario')
const userRole = computed(() => auth.role || 'Sin Rol')
const userInitials = computed(() => {
  const name = userName.value.toUpperCase()
  return name.slice(0, 2)
})

async function logout() {
  try {
    await auth.signOut()
  } catch (e) {
    console.error('Logout error:', e)
  } finally {
    // Forzamos una recarga fuerte (Hard Reload) hacia login 
    // para destruir garantizadamente cualquier estado residual en SSR, Pinia o Memoria.
    window.location.href = '/login'
  }
}
</script>

<style scoped>
.v-list-item--active {
  background: rgba(255, 202, 40, 0.15); 
}
.v-list-item--active .v-list-item-title {
  color: #FFCA28 !important;
}
</style>
