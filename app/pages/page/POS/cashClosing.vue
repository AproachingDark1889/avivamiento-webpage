<template>
  <div class="pa-4 h-100 d-flex flex-column">
    <div class="d-flex align-center mb-4">
      <h1 class="text-h4 font-weight-black text-primary">
        <v-icon start size="36">mdi-cash-register</v-icon>Corte de Caja
      </h1>
      <v-spacer />
      <v-btn-toggle v-model="activeTab" mandatory color="primary" density="compact" rounded="lg" class="ml-2">
        <v-btn value="current" prepend-icon="mdi-calculator">Corte Actual</v-btn>
        <v-btn value="history" prepend-icon="mdi-history">Historial</v-btn>
      </v-btn-toggle>
    </div>

    <!-- ═══════════════════════════════ -->
    <!-- TAB: Corte Actual              -->
    <!-- ═══════════════════════════════ -->
    <v-card v-if="activeTab === 'current'" elevation="2" class="pa-4 flex-grow-1 overflow-y-auto" rounded="xl" border>
      <div class="d-flex align-center mb-4">
        <div class="text-h6 font-weight-bold">Registro de Cierre</div>
      </div>

      <v-row>
        <v-col cols="12" md="4">
          <v-text-field
            v-model="date"
            label="Fecha"
            type="date"
            variant="outlined"
            density="compact"
          />
        </v-col>

        <v-col cols="12" md="4">
          <v-text-field
            v-model="openingCashInput"
            label="Efectivo inicial (cambio)"
            type="number"
            inputmode="decimal"
            variant="outlined"
            density="compact"
          />
        </v-col>

        <v-col cols="12" md="4">
          <v-text-field
            v-model="cashCountedInput"
            label="Efectivo contado"
            type="number"
            inputmode="decimal"
            variant="outlined"
            density="compact"
          />
        </v-col>
      </v-row>

      <v-row>
        <v-col cols="12" md="4">
          <v-btn
            color="primary"
            block
            :loading="loading"
            @click="calculate"
            prepend-icon="mdi-calculator"
            height="40"
          >
            Calcular
          </v-btn>
        </v-col>

        <v-col cols="12" md="8" class="d-flex align-center">
          <v-alert v-if="warning" type="warning" variant="tonal" class="mb-0 py-2" density="compact" style="width: 100%;">
            {{ warning }}
          </v-alert>
        </v-col>
      </v-row>
      
      <v-divider class="my-6" />
      
      <div class="text-h6 font-weight-bold mb-4">Resumen</div>

      <v-row>
        <v-col cols="12" md="3">
          <v-card elevation="0" class="pa-4 border bg-grey-lighten-5">
            <div class="text-caption font-weight-bold text-medium-emphasis">Ventas del día</div>
            <div class="text-h5 font-weight-black text-primary">{{ money(salesTotal) }}</div>
            <div class="text-caption text-medium-emphasis mt-1">{{ ordersCount }} órdenes</div>
          </v-card>
        </v-col>

        <v-col cols="12" md="3">
          <v-card elevation="0" class="pa-4 border bg-grey-lighten-5">
            <div class="text-caption font-weight-bold text-medium-emphasis">Efectivo esperado</div>
            <div class="text-h5 font-weight-black text-secondary">{{ money(expectedCash) }}</div>
          </v-card>
        </v-col>

        <v-col cols="12" md="3">
          <v-card elevation="0" class="pa-4 border bg-grey-lighten-5">
            <div class="text-caption font-weight-bold text-medium-emphasis">Efectivo contado</div>
            <div class="text-h5 font-weight-black">{{ money(cashCounted) }}</div>
          </v-card>
        </v-col>

        <v-col cols="12" md="3">
          <v-card elevation="0" class="pa-4 border" :class="difference < 0 ? 'bg-red-lighten-5' : 'bg-green-lighten-5'">
            <div class="text-caption font-weight-bold text-medium-emphasis">Diferencia</div>
            <div class="text-h5 font-weight-black" :class="difference < 0 ? 'text-error' : 'text-success'">{{ money(difference) }}</div>
          </v-card>
        </v-col>
      </v-row>

      <!-- Desglose por método de pago -->
      <v-divider class="my-6" />
      <div class="text-h6 font-weight-bold mb-4">Desglose por Método de Pago</div>

      <v-row>
        <v-col cols="12" md="4">
          <v-card elevation="0" class="pa-4 border bg-green-lighten-5">
            <div class="d-flex align-center mb-1">
              <v-icon color="green" size="20" class="mr-2">mdi-cash</v-icon>
              <span class="text-caption font-weight-bold text-medium-emphasis">Efectivo</span>
            </div>
            <div class="text-h5 font-weight-black text-green">{{ money(cashSales) }}</div>
          </v-card>
        </v-col>
        <v-col cols="12" md="4">
          <v-card elevation="0" class="pa-4 border bg-blue-lighten-5">
            <div class="d-flex align-center mb-1">
              <v-icon color="blue" size="20" class="mr-2">mdi-credit-card</v-icon>
              <span class="text-caption font-weight-bold text-medium-emphasis">Tarjeta</span>
            </div>
            <div class="text-h5 font-weight-black text-blue">{{ money(cardSales) }}</div>
          </v-card>
        </v-col>
        <v-col cols="12" md="4">
          <v-card elevation="0" class="pa-4 border bg-purple-lighten-5">
            <div class="d-flex align-center mb-1">
              <v-icon color="purple" size="20" class="mr-2">mdi-bank-transfer</v-icon>
              <span class="text-caption font-weight-bold text-medium-emphasis">Transferencia</span>
            </div>
            <div class="text-h5 font-weight-black text-purple">{{ money(transferSales) }}</div>
          </v-card>
        </v-col>
      </v-row>

      <!-- Contexto Operativo -->
      <v-divider class="my-6" />
      <div class="text-h6 font-weight-bold mb-4">Contexto Operativo (Órdenes Pagadas)</div>

      <v-row>
        <v-col cols="12" md="4">
          <v-card elevation="0" class="pa-3 border bg-grey-lighten-5 d-flex justify-space-between align-center">
            <span class="text-caption font-weight-bold text-medium-emphasis">Entregadas en Cocina</span>
            <span class="text-h6 font-weight-black">{{ opCompleted }}</span>
          </v-card>
        </v-col>
        <v-col cols="12" md="4">
          <v-card elevation="0" class="pa-3 border bg-grey-lighten-5 d-flex justify-space-between align-center">
            <span class="text-caption font-weight-bold text-medium-emphasis">Pendientes</span>
            <span class="text-h6 font-weight-black">{{ opPending }}</span>
          </v-card>
        </v-col>
        <v-col cols="12" md="4">
          <v-card elevation="0" class="pa-3 border bg-orange-lighten-5 d-flex justify-space-between align-center">
            <span class="text-caption font-weight-bold text-orange-darken-3">Incidencias</span>
            <span class="text-h6 font-weight-black text-orange-darken-3">{{ opIncidences }}</span>
          </v-card>
        </v-col>
      </v-row>

      <!-- Notas -->
      <v-divider class="my-6" />
      <v-textarea
        v-model="notes"
        label="Notas del cierre (opcional)"
        variant="outlined"
        rows="2"
        density="compact"
        placeholder="Ej: Faltaron $50, el cliente X no pagó..."
      />

      <!-- Estado de corrección -->
      <v-alert v-if="isCorrectionMode" type="info" variant="tonal" class="mb-4" density="compact">
        <strong>Corte ya registrado.</strong> Puedes corregirlo indicando el motivo.
      </v-alert>

      <!-- Campo revision_note (solo en modo corrección) -->
      <v-textarea
        v-if="isCorrectionMode"
        v-model="revisionNote"
        label="Motivo de corrección (obligatorio)"
        variant="outlined"
        rows="2"
        density="compact"
        placeholder="Ej: Se recontó el efectivo, faltaban monedas..."
        :rules="[v => !!v?.trim() || 'Motivo requerido para corregir']"
        class="mb-4"
      />

      <!-- Alerta de duplicados -->
      <v-alert v-if="hasDuplicates" type="error" variant="tonal" class="mb-4" density="compact">
        ⚠️ Existen cortes duplicados para esta fecha. Requiere revisión administrativa.
      </v-alert>

      <v-btn
        :color="isCorrectionMode ? 'warning' : 'success'"
        block
        size="large"
        :loading="saving"
        :disabled="!canSave"
        @click="saveClosure"
        rounded="lg"
        class="font-weight-bold text-h6"
      >
        <v-icon start>{{ isCorrectionMode ? 'mdi-pencil-circle' : 'mdi-content-save-check' }}</v-icon>
        {{ isCorrectionMode ? 'Corregir corte' : 'Guardar Corte de Caja' }}
      </v-btn>

      <div class="mt-4 text-center text-caption text-medium-emphasis">
        "Su amor es el mismo: ayer, hoy y por los siglos." — Hebreos 13:8
      </div>
    </v-card>

    <!-- ═══════════════════════════════ -->
    <!-- TAB: Historial                 -->
    <!-- ═══════════════════════════════ -->
    <v-card v-if="activeTab === 'history'" elevation="2" class="pa-4 flex-grow-1 overflow-y-auto" rounded="xl" border>
      <div class="d-flex align-center mb-4">
        <div class="text-h6 font-weight-bold">Historial de Cortes</div>
        <v-spacer />
        <v-btn color="primary" variant="text" icon="mdi-refresh" :loading="historyLoading" @click="loadHistory" />
      </div>

      <v-alert v-if="historyWarning" type="warning" variant="tonal" class="mb-4" density="compact">
        {{ historyWarning }}
      </v-alert>

      <v-table v-if="closures.length > 0" density="compact" hover>
        <thead>
          <tr>
            <th class="text-left">Fecha</th>
            <th class="text-right">Ventas</th>
            <th class="text-right">Efectivo</th>
            <th class="text-right">Tarjeta</th>
            <th class="text-right">Transf.</th>
            <th class="text-right">Diferencia</th>
            <th class="text-right">Órdenes</th>
            <th class="text-left">Notas</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in closures" :key="c.id">
            <td class="font-weight-bold">{{ formatDate(c.closure_date) }}</td>
            <td class="text-right font-weight-bold text-primary">{{ money(c.sales_total) }}</td>
            <td class="text-right text-green">{{ money(c.total_cash_sales) }}</td>
            <td class="text-right text-blue">{{ money(c.total_card_sales) }}</td>
            <td class="text-right text-purple">{{ money(c.total_transfer_sales) }}</td>
            <td class="text-right font-weight-bold" :class="c.difference < 0 ? 'text-error' : 'text-success'">
              {{ money(c.difference) }}
            </td>
            <td class="text-right">{{ c.orders_count }}</td>
            <td class="text-caption text-medium-emphasis" style="max-width: 200px;">
              {{ c.notes || '—' }}
            </td>
          </tr>
        </tbody>
      </v-table>

      <div v-else-if="!historyLoading" class="text-center pa-8 text-medium-emphasis">
        <v-icon size="64" class="mb-4">mdi-clipboard-text-clock-outline</v-icon>
        <div class="text-h6">Sin cortes registrados</div>
        <div class="text-body-2 mt-1">Los cortes guardados aparecerán aquí</div>
      </div>
    </v-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useAuthStore } from '../../../stores/auth'
import { useToast } from '../../../composables/useToast'
import { useSupabase } from '../../../composables/useSupabase'
import { formatMoney } from '../../../utils/format'

definePageMeta({ middleware: ['auth', 'role-cashier'], layout: 'sistema' })
useHead({ title: 'Corte de Caja - Aviva Check' })

const auth = useAuthStore()
const toast = useToast()
const loading = ref(false)
const saving = ref(false)
const warning = ref('')

const activeTab = ref('current')
const date = ref('')
const notes = ref('')

const openingCashInput = ref<string>('0')
const cashCountedInput = ref<string>('0')

const salesTotal = ref(0)
const cashSales = ref(0)
const cardSales = ref(0)
const transferSales = ref(0)
const ordersCount = ref(0)

const opCompleted = ref(0)
const opPending = ref(0)
const opIncidences = ref(0)

// Correction mode state
const existingClosureId = ref<string | null>(null)
const hasDuplicates = ref(false)
const revisionNote = ref('')
const hasCalculated = ref(false)

const isCorrectionMode = computed(() => existingClosureId.value !== null && !hasDuplicates.value)

// History
const closures = ref<any[]>([])
const historyLoading = ref(false)
const historyWarning = ref('')

function todayISO() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

onMounted(async () => {
  await auth.init()
  date.value = todayISO()
  calculate()
})

// Reset state when user picks a different date — forces re-Calculate
watch(date, () => {
  hasCalculated.value = false
  existingClosureId.value = null
  hasDuplicates.value = false
  revisionNote.value = ''
})

const money = (amount: number) => formatMoney(amount || 0)

function num(v: string) {
  const n = Number(v || 0)
  return Number.isFinite(n) ? n : 0
}

function formatDate(d: string) {
  if (!d) return '—'
  return new Date(d + 'T12:00:00').toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}

const openingCash = computed(() => num(openingCashInput.value))
const cashCounted = computed(() => num(cashCountedInput.value))
const expectedCash = computed(() => openingCash.value + cashSales.value)
const difference = computed(() => cashCounted.value - expectedCash.value)

const canSave = computed(() => {
  if (saving.value) return false
  if (!date.value) return false
  if (!hasCalculated.value) return false
  if (hasDuplicates.value) return false
  if (isCorrectionMode.value && !revisionNote.value.trim()) return false
  return true
})

function getSupabase() {
  try { return useSupabase() } catch { return null }
}

function currentDepartmentOwnerId() {
  const profile = auth.profile
  if (!profile) return null
  if (profile.role === 'pastor' || profile.role === 'leader' || profile.role === 'super_admin') return profile.id
  return profile.owner_id || null
}

function shouldFilterByDepartment() {
  const role = auth.profile?.role
  return role !== 'pastor' && role !== 'super_admin'
}

// Vista previa aproximada: usa hora local del navegador.
// Los totales finales los calcula el RPC save_cash_closure con TZ America/Mexico_City.
// En bordes de medianoche puede haber diferencias menores entre preview y cálculo real.
function dayRangeISO(d: string) {
  const start = new Date(`${d}T00:00:00`)
  const end = new Date(`${d}T23:59:59.999`)
  return { startISO: start.toISOString(), endISO: end.toISOString() }
}

async function calculate() {
  warning.value = ''
  existingClosureId.value = null
  hasDuplicates.value = false
  hasCalculated.value = false
  revisionNote.value = ''

  const sb = getSupabase()
  if (!sb?.from) {
    warning.value = 'No se detectó Supabase en runtime.'
    return
  }

  if (!date.value) {
    warning.value = 'Selecciona una fecha.'
    return
  }

  loading.value = true
  try {
    const { startISO, endISO } = dayRangeISO(date.value)
    const orgId = auth.profile?.org_id
    const deptOwnerId = currentDepartmentOwnerId()
    if (!orgId) {
      warning.value = 'Tu usuario no tiene organizacion asignada.'
      return
    }

    // Vista previa de órdenes (solo para mostrar en pantalla)
    let ordersQuery = sb
      .from('orders')
      .select('total,payment_method,financial_review_required,operational_status')
      .eq('org_id', orgId)
      .eq('financial_status', 'paid')
      .gte('created_at', startISO)
      .lte('created_at', endISO)
      .limit(5000)

    if (deptOwnerId) {
      ordersQuery = ordersQuery.eq('department_owner_id', deptOwnerId)
    }

    const { data, error } = await ordersQuery

    if (error) throw error

    const rows = data ?? []
    ordersCount.value = rows.length
    salesTotal.value = rows.reduce((sum: number, r: any) => sum + Number(r.total ?? 0), 0)
    
    // Desglose por método de pago
    cashSales.value = rows
      .filter((r: any) => r.payment_method === 'cash' || !r.payment_method)
      .reduce((sum: number, r: any) => sum + Number(r.total ?? 0), 0)
    
    cardSales.value = rows
      .filter((r: any) => r.payment_method === 'card')
      .reduce((sum: number, r: any) => sum + Number(r.total ?? 0), 0)
    
    transferSales.value = rows
      .filter((r: any) => r.payment_method === 'transfer')
      .reduce((sum: number, r: any) => sum + Number(r.total ?? 0), 0)

    // Contexto operativo
    opCompleted.value = rows.filter((r: any) => r.operational_status === 'completed').length
    opPending.value = rows.filter((r: any) => r.operational_status === 'pending').length
    opIncidences.value = rows.filter((r: any) => r.operational_status === 'kitchen_rejected' || r.operational_status === 'kitchen_cancelled').length

    const hasReviewRequired = rows.some((r: any) => r.financial_review_required === true)
    if (hasReviewRequired) {
      warning.value = '⚠️ Atención: Estas incidencias no descuentan dinero automáticamente. Si se devolvió efectivo, documenta la explicación en notas del corte.'
    }

    // Detectar corte existente por org_id + closure_date
    // Filtro defensivo: no depender solo de RLS para aislar por org
    const { data: existing, error: existErr } = await sb
      .from('cash_closures')
      .select('id, closed_by, opening_cash, cash_counted, notes')
      .eq('org_id', orgId)
      .eq('department_owner_id', deptOwnerId)
      .eq('closure_date', date.value)
      .order('created_at', { ascending: false })

    if (!existErr && existing) {
      if (existing.length > 1) {
        hasDuplicates.value = true
        warning.value = '⚠️ Existen cortes duplicados para esta fecha. Requiere revisión administrativa.'
      } else if (existing.length === 1) {
        existingClosureId.value = existing[0].id
        openingCashInput.value = String(existing[0].opening_cash ?? 0)
        cashCountedInput.value = String(existing[0].cash_counted ?? 0)
        notes.value = existing[0].notes ?? ''
      }
    }

    hasCalculated.value = true

  } catch (e: any) {
    warning.value = `Error: ${e?.message ?? String(e)}`
  } finally {
    loading.value = false
  }
}

async function saveClosure() {
  const sb = getSupabase()
  if (!sb?.rpc) {
    toast.error('Supabase no detectado. No se puede guardar.')
    return
  }

  saving.value = true
  try {
    const { data, error } = await sb.rpc('save_cash_closure', {
      p_closure_date: date.value,
      p_opening_cash: openingCash.value,
      p_cash_counted: cashCounted.value,
      p_notes: notes.value.trim() || null,
      p_revision_note: isCorrectionMode.value ? revisionNote.value.trim() : null
    })

    if (error) throw error

    const action = data?.action === 'corrected' ? 'Corte corregido' : 'Corte guardado'
    toast.success(`${action} correctamente`)
    revisionNote.value = ''

    // Recargar estado para reflejar el corte recién guardado
    await calculate()
  } catch (e: any) {
    toast.error(`Error: ${e?.message ?? String(e)}`)
  } finally {
    saving.value = false
  }
}

async function loadHistory() {
  historyWarning.value = ''
  const sb = getSupabase()
  if (!sb?.from) {
    historyWarning.value = 'Supabase no detectado.'
    return
  }

  historyLoading.value = true
  try {
    const orgId = auth.profile?.org_id
    const deptOwnerId = currentDepartmentOwnerId()
    if (!orgId) {
      historyWarning.value = 'Tu usuario no tiene organizacion asignada.'
      return
    }

    let query = sb
      .from('cash_closures')
      .select('*')
      .eq('org_id', orgId)
      .order('closure_date', { ascending: false })
      .limit(50)

    if (shouldFilterByDepartment() && deptOwnerId) {
      query = query.eq('department_owner_id', deptOwnerId)
    }

    const { data, error } = await query

    if (error) throw error
    closures.value = data ?? []
  } catch (e: any) {
    historyWarning.value = e?.message ?? String(e)
  } finally {
    historyLoading.value = false
  }
}

// Auto-load history when switching tabs
watch(activeTab, (tab) => {
  if (tab === 'history' && closures.value.length === 0) {
    loadHistory()
  }
})
</script>
