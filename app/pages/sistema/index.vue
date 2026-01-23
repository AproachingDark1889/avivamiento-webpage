<template>
  <v-container class="pa-4" fluid>
    <v-row>
      <v-col cols="12" md="4">
        <v-card elevation="2" class="pa-4 h-100" rounded="lg">
          <div class="d-flex align-center mb-2">
            <v-icon icon="mdi-point-of-sale" color="primary" size="32" class="mr-3" />
            <div style="font-weight: 900; font-size: 20px;">POS (Caja)</div>
          </div>
          <div class="mb-4 text-body-2 text-medium-emphasis">
            Registrar pedidos, cobrar y gestionar ventas.
          </div>
          <v-btn
            color="primary"
            block
            rounded="lg"
            :disabled="!auth.canAccessPos"
            to="/sistema/pos"
            prepend-icon="mdi-open-in-new"
          >
            Abrir POS
          </v-btn>
        </v-card>
      </v-col>

      <v-col cols="12" md="4">
        <v-card elevation="2" class="pa-4 h-100" rounded="lg">
          <div class="d-flex align-center mb-2">
            <v-icon icon="mdi-chef-hat" color="primary" size="32" class="mr-3" />
            <div style="font-weight: 900; font-size: 20px;">KDS (Cocina)</div>
          </div>
          <div class="mb-4 text-body-2 text-medium-emphasis">
            Pantalla de cocina para gestionar y despachar órdenes.
          </div>
          <v-btn
            color="primary"
            block
            rounded="lg"
            :disabled="!auth.canAccessKds"
            to="/sistema/kds"
            prepend-icon="mdi-open-in-new"
          >
             Abrir KDS
          </v-btn>
        </v-card>
      </v-col>

      <v-col cols="12" md="4">
        <v-card elevation="2" class="pa-4 h-100" rounded="lg">
          <div class="d-flex align-center mb-2">
            <v-icon icon="mdi-chart-line" color="primary" size="32" class="mr-3" />
            <div style="font-weight: 900; font-size: 20px;">Reportes</div>
          </div>
          <div class="mb-4 text-body-2 text-medium-emphasis">
            Analizar ventas, cortes y métricas de rendimiento.
          </div>
          <v-btn
            color="primary"
            block
            rounded="lg"
            :disabled="!auth.canViewReports"
            to="/sistema/reportes"
            prepend-icon="mdi-eye"
          >
            Ver Reportes
          </v-btn>
        </v-card>
      </v-col>

      <v-col cols="12" md="6">
        <v-card elevation="2" class="pa-4" rounded="lg">
          <div class="d-flex align-center mb-2">
            <v-icon icon="mdi-cash-register" color="primary" size="32" class="mr-3" />
            <div style="font-weight: 900; font-size: 20px;">Corte de Caja</div>
          </div>
          <div class="mb-4 text-body-2 text-medium-emphasis">
            Realizar el cierre del día y cuadrar efectivo.
          </div>
          <v-btn
            color="primary"
            block
            rounded="lg"
            :disabled="!auth.canCloseCash"
            to="/sistema/corte"
            prepend-icon="mdi-calculator"
          >
            Realizar Corte
          </v-btn>
        </v-card>
      </v-col>

      <v-col cols="12" md="6">
        <v-card elevation="2" class="pa-4" rounded="lg">
          <div class="d-flex align-center mb-2">
            <v-icon icon="mdi-account-group" color="primary" size="32" class="mr-3" />
            <div style="font-weight: 900; font-size: 20px;">Usuarios</div>
          </div>
          <div class="mb-4 text-body-2 text-medium-emphasis">
            Administrar accesos y roles (Solo Líderes).
          </div>
          <v-btn
            color="primary"
            block
            rounded="lg"
            :disabled="!auth.canManageUsers"
            to="/sistema/admin/usuarios"
            prepend-icon="mdi-cog"
          >
            Gestionar Usuarios
          </v-btn>
        </v-card>
      </v-col>
    </v-row>

    <v-divider class="my-6" />

    <v-card elevation="1" class="pa-4" rounded="lg" variant="tonal" color="primary">
      <div style="font-weight: 900; font-size: 16px;">Estado de Sesión</div>
      <div class="mt-2 d-flex flex-wrap gap-4" style="opacity: 0.9;">
        <v-chip size="small" color="primary" class="mr-2">Rol: {{ auth.role ?? '—' }}</v-chip>
        <v-chip size="small" variant="outlined" class="mr-2">Usuario: {{ auth.profile?.display_name ?? auth.user?.email }}</v-chip>
        <v-chip size="small" variant="outlined">ID: {{ auth.user?.id?.slice(0,8) }}...</v-chip>
      </div>
    </v-card>
  </v-container>
</template>

<script setup lang="ts">
import { useAuthStore } from '../../stores/auth'

definePageMeta({ middleware: ['auth'], layout: 'sistema' })
useHead({ title: 'Sistema - Aviva Check' })

const auth = useAuthStore()
</script>
