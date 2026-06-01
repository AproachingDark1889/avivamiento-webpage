<template>
  <ClientOnly>
    <v-app>
      <v-app-bar app color="primary" height="64">
        <v-container class="d-flex align-center">
          <v-toolbar-title style="color: white; font-weight: 800;">
            Acceso denegado
          </v-toolbar-title>

          <v-spacer />

          <v-btn href="/login" variant="text" style="color: white; text-transform: none;">
            Login
          </v-btn>
        </v-container>
      </v-app-bar>

      <v-main>
        <v-container class="pa-4" style="max-width: 720px;">
          <v-card elevation="2">
            <v-card-title style="font-weight: 900;">
              No tienes permisos para ver esta sección.
            </v-card-title>

            <v-divider />

            <v-card-text>
              <div style="opacity: 0.9;">
                Razón: <strong>{{ reasonText }}</strong>
              </div>

              <v-alert type="info" variant="tonal" class="mt-4">
                Esto evita que alguien con el link use la interfaz, pero la seguridad real debe vivir en Supabase (RLS).
              </v-alert>

              <div class="d-flex align-center mt-4">
                <v-btn color="primary" href="/page/POS" style="text-transform: none;">
                  Ir a Sistema
                </v-btn>
                <v-spacer />
                <v-btn variant="outlined" href="/land" style="text-transform: none;">
                  Volver al sitio
                </v-btn>
              </div>
            </v-card-text>
          </v-card>
        </v-container>
      </v-main>
    </v-app>
  </ClientOnly>
</template>

<script setup lang="ts">
import { computed } from 'vue'

useHead({ title: 'Acceso denegado' })

const route = useRoute()

const reasonText = computed(() => {
  const r = route.query.reason
  if (r === 'no-profile') return 'Usuario sin perfil/rol (profiles)'
  if (r === 'role') return 'Rol insuficiente'
  return 'Desconocida'
})
</script>
