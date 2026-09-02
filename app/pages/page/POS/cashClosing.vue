<template>
  <div class="pa-4 h-100 d-flex flex-column">
    <div class="d-flex align-center mb-4">
      <h1 class="text-h4 font-weight-black text-primary">
        <v-icon start size="36">mdi-cash-register</v-icon>Corte de Caja
      </h1>
      <v-spacer />
      <v-btn-toggle v-model="activeTab" mandatory color="primary" density="compact" rounded="lg" class="ml-2">
        <v-btn value="current" prepend-icon="mdi-calculator">Actual</v-btn>
        <v-btn value="history" prepend-icon="mdi-history">Historial</v-btn>
      </v-btn-toggle>
    </div>

    <v-card v-if="activeTab === 'current'" elevation="2" class="pa-4 flex-grow-1 overflow-y-auto" rounded="xl" border>
      <div class="d-flex align-center mb-4">
        <div class="text-h6 font-weight-bold">Sesion de Caja</div>
        <v-spacer />
        <v-btn color="primary" variant="text" icon="mdi-refresh" :loading="loading" @click="loadAll" />
      </div>

      <v-alert v-if="warning" type="warning" variant="tonal" class="mb-4" density="compact">
        {{ warning }}
      </v-alert>

      <v-btn-toggle
        v-if="cashModeOptions.length > 1"
        :model-value="selectedCashMode"
        color="primary"
        mandatory
        density="compact"
        rounded="lg"
        class="mb-4"
        @update:model-value="selectCashMode"
      >
        <v-btn
          v-for="option in cashModeOptions"
          :key="option.value"
          :value="option.value"
        >
          <v-icon start>{{ option.icon }}</v-icon>
          {{ option.label }}
        </v-btn>
      </v-btn-toggle>

      <v-alert v-if="!currentSession && !loading" type="info" variant="tonal" class="mb-4">
        No hay caja abierta para tu contexto actual.
        <template #append>
          <v-btn color="primary" variant="tonal" size="small" @click="goToPos">Ir al POS</v-btn>
        </template>
      </v-alert>

      <template v-if="currentSession">
        <v-row class="mb-4">
          <v-col cols="12" md="3">
            <v-card elevation="0" class="pa-4 border bg-grey-lighten-5">
              <div class="text-caption font-weight-bold text-medium-emphasis">Modo</div>
              <div class="text-h6 font-weight-black text-primary">{{ modeLabel(currentSession.mode) }}</div>
            </v-card>
          </v-col>
          <v-col cols="12" md="3">
            <v-card elevation="0" class="pa-4 border bg-grey-lighten-5">
              <div class="text-caption font-weight-bold text-medium-emphasis">Estado</div>
              <div class="text-h6 font-weight-black">{{ statusLabel(currentSession.status) }}</div>
            </v-card>
          </v-col>
          <v-col cols="12" md="3">
            <v-card elevation="0" class="pa-4 border bg-grey-lighten-5">
              <div class="text-caption font-weight-bold text-medium-emphasis">Apertura</div>
              <div class="text-body-1 font-weight-bold">{{ formatDateTime(currentSession.opened_at) }}</div>
            </v-card>
          </v-col>
          <v-col cols="12" md="3">
            <v-card elevation="0" class="pa-4 border bg-grey-lighten-5">
              <div class="text-caption font-weight-bold text-medium-emphasis">Fondo inicial</div>
              <div class="text-h6 font-weight-black text-secondary">{{ money(currentSession.opening_cash) }}</div>
            </v-card>
          </v-col>
        </v-row>

        <v-row>
          <v-col cols="12" md="3">
            <v-card elevation="0" class="pa-4 border bg-grey-lighten-5">
              <div class="text-caption font-weight-bold text-medium-emphasis">Ventas</div>
              <div class="text-h5 font-weight-black text-primary">{{ money(salesTotal) }}</div>
              <div class="text-caption text-medium-emphasis mt-1">{{ ordersCount }} ordenes</div>
            </v-card>
          </v-col>
          <v-col cols="12" md="3">
            <v-card elevation="0" class="pa-4 border bg-green-lighten-5">
              <div class="text-caption font-weight-bold text-medium-emphasis">Efectivo esperado</div>
              <div class="text-h5 font-weight-black text-green">{{ money(expectedCash) }}</div>
            </v-card>
          </v-col>
          <v-col cols="12" md="3">
            <v-card elevation="0" class="pa-4 border bg-blue-lighten-5">
              <div class="text-caption font-weight-bold text-medium-emphasis">Tarjeta</div>
              <div class="text-h5 font-weight-black text-blue">{{ money(cardSales) }}</div>
            </v-card>
          </v-col>
          <v-col cols="12" md="3">
            <v-card elevation="0" class="pa-4 border bg-purple-lighten-5">
              <div class="text-caption font-weight-bold text-medium-emphasis">Transferencia</div>
              <div class="text-h5 font-weight-black text-purple">{{ money(transferSales) }}</div>
            </v-card>
          </v-col>
        </v-row>

        <v-divider class="my-6" />

        <v-alert v-if="currentSession.status === 'pending_validation'" type="warning" variant="tonal" class="mb-4">
          Esta caja esta en validacion. No se pueden registrar mas ventas en esta sesion.
        </v-alert>

        <template v-if="currentSession.status === 'open'">
          <v-row>
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
            <v-col cols="12" md="8">
              <v-textarea
                v-model="notes"
                label="Notas del cierre (opcional)"
                rows="1"
                variant="outlined"
                density="compact"
              />
            </v-col>
          </v-row>

          <v-btn
            color="success"
            block
            size="large"
            :loading="saving"
            :disabled="!canPreClose"
            @click="preCloseCurrentSession"
            rounded="lg"
            class="font-weight-bold text-h6"
          >
            <v-icon start>mdi-lock-check</v-icon>
            Pre-cerrar Caja
          </v-btn>
        </template>
      </template>

      <!-- Monitoreo y Pre-cierre de Contingencia para Liderazgo/Pastores -->
      <template v-if="canApprove && openSessions.length > 0">
        <v-divider class="my-6" />
        <div class="d-flex align-center mb-2">
          <v-icon icon="mdi-shield-alert-outline" color="warning" class="mr-2" />
          <div class="text-h6 font-weight-bold">Cajas Abiertas</div>
        </div>
        <div class="text-caption text-medium-emphasis mb-4">
          Si un cajero (independiente o compartido) perdió conexión o se retiró sin hacer corte, el liderazgo puede pre-cerrar su caja desde aquí.
        </div>

        <v-row class="mb-4">
          <v-col v-for="session in openSessions" :key="session.id" cols="12" md="6">
            <v-card elevation="0" class="pa-4 border bg-blue-grey-lighten-5">
              <div class="d-flex align-center mb-3">
                <v-chip size="small" color="primary" variant="flat" class="font-weight-bold">
                  {{ modeLabel(session.mode) }}
                </v-chip>
                <v-spacer />
                <span class="text-caption text-medium-emphasis">{{ formatDateTime(session.opened_at) }}</span>
              </div>
              <div class="d-flex justify-space-between text-body-2 mb-1">
                <span>Efectivo Inicial</span>
                <strong>{{ money(session.opening_cash) }}</strong>
              </div>
              <div class="d-flex justify-space-between text-body-2 mb-3">
                <span>Órdenes / Ventas</span>
                <strong class="text-primary">{{ session.orders_count }} órdenes ({{ money(session.sales_total) }})</strong>
              </div>
              <v-btn color="warning" variant="flat" block rounded="lg" prepend-icon="mdi-lock-alert" @click="openContingencyModal(session)">
                Pre-cerrar (Contingencia)
              </v-btn>
            </v-card>
          </v-col>
        </v-row>
      </template>

      <template v-if="canApprove && pendingSessions.length > 0">
        <v-divider class="my-6" />
        <div class="text-h6 font-weight-bold mb-4">Cajas Pendientes de Validacion</div>

        <v-row>
          <v-col v-for="session in pendingSessions" :key="session.id" cols="12" md="6">
            <v-card elevation="0" class="pa-4 border bg-orange-lighten-5">
              <div class="d-flex align-center mb-3">
                <v-chip size="small" color="orange" variant="flat" class="font-weight-bold">
                  {{ modeLabel(session.mode) }}
                </v-chip>
                <v-spacer />
                <span class="text-caption text-medium-emphasis">{{ formatDateTime(session.preclosed_at || session.opened_at) }}</span>
              </div>
              <div class="d-flex justify-space-between text-body-2 mb-1">
                <span>Ventas</span>
                <strong>{{ money(session.sales_total) }}</strong>
              </div>
              <div class="d-flex justify-space-between text-body-2 mb-1">
                <span>Efectivo esperado</span>
                <strong>{{ money(session.expected_cash || 0) }}</strong>
              </div>
              <div class="d-flex justify-space-between text-body-2 mb-3">
                <span>Diferencia</span>
                <strong :class="Number(session.difference || 0) < 0 ? 'text-error' : 'text-success'">
                  {{ money(session.difference || 0) }}
                </strong>
              </div>
              <v-btn color="primary" block rounded="lg" :loading="saving" @click="approveSession(session.id)">
                Aprobar cierre
              </v-btn>
            </v-card>
          </v-col>
        </v-row>
      </template>
    </v-card>

    <v-card v-if="activeTab === 'history'" elevation="2" class="pa-4 flex-grow-1 overflow-y-auto" rounded="xl" border>
      <div class="d-flex align-center mb-4">
        <div class="text-h6 font-weight-bold">Historial de Sesiones</div>
        <v-spacer />
        <v-btn color="primary" variant="text" icon="mdi-refresh" :loading="historyLoading" @click="loadHistory" />
      </div>

      <v-alert v-if="historyWarning" type="warning" variant="tonal" class="mb-4" density="compact">
        {{ historyWarning }}
      </v-alert>

      <v-table v-if="historySessions.length > 0" density="compact" hover>
        <thead>
          <tr>
            <th class="text-left">Apertura</th>
            <th class="text-left">Modo</th>
            <th class="text-right">Ventas</th>
            <th class="text-right">Efectivo</th>
            <th class="text-right">Tarjeta</th>
            <th class="text-right">Transf.</th>
            <th class="text-right">Diferencia</th>
            <th class="text-right">Ordenes</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="session in historySessions" :key="session.id">
            <td class="font-weight-bold">{{ formatDateTime(session.opened_at) }}</td>
            <td>{{ modeLabel(session.mode) }}</td>
            <td class="text-right font-weight-bold text-primary">{{ money(session.sales_total) }}</td>
            <td class="text-right text-green">{{ money(session.total_cash_sales) }}</td>
            <td class="text-right text-blue">{{ money(session.total_card_sales) }}</td>
            <td class="text-right text-purple">{{ money(session.total_transfer_sales) }}</td>
            <td class="text-right font-weight-bold" :class="Number(session.difference || 0) < 0 ? 'text-error' : 'text-success'">
              {{ money(session.difference || 0) }}
            </td>
            <td class="text-right">{{ session.orders_count }}</td>
          </tr>
        </tbody>
      </v-table>

      <div v-else-if="!historyLoading" class="text-center pa-8 text-medium-emphasis">
        <v-icon size="64" class="mb-4">mdi-clipboard-text-clock-outline</v-icon>
        <div class="text-h6">Sin sesiones cerradas</div>
        <div class="text-body-2 mt-1">Los cortes aprobados apareceran aqui</div>
      </div>
    </v-card>

    <!-- Dialogo de Contingencia (Liderazgo) -->
    <v-dialog v-model="contingencyDialog" max-width="500">
      <v-card class="pa-6" rounded="xl">
        <div class="d-flex align-center mb-4">
          <v-icon icon="mdi-lock-alert" color="warning" size="32" class="mr-3" />
          <div>
            <div class="text-h6 font-weight-bold">Pre-cierre de Contingencia</div>
            <div class="text-caption text-medium-emphasis">Toma de control por Liderazgo</div>
          </div>
        </div>

        <p class="text-body-2 text-medium-emphasis mb-4">
          Estás por pre-cerrar y mandar a validación la sesión <strong>{{ modeLabel(contingencySession?.mode) }}</strong> abierta desde <strong>{{ formatDateTime(contingencySession?.opened_at) }}</strong>.
        </p>

        <v-text-field
          v-model="contingencyCashCounted"
          label="Efectivo físico contado en cajón ($)"
          type="number"
          variant="outlined"
          density="comfortable"
          prepend-inner-icon="mdi-cash"
          class="mb-4"
        />

        <v-textarea
          v-model="contingencyNotes"
          label="Nota o justificación de contingencia (Obligatorio)"
          variant="outlined"
          density="comfortable"
          rows="2"
          class="mb-6"
        />

        <div class="d-flex gap-3">
          <v-spacer />
          <v-btn variant="text" @click="contingencyDialog = false">Cancelar</v-btn>
          <v-btn
            color="warning"
            variant="flat"
            :loading="saving"
            :disabled="!contingencyNotes.trim()"
            @click="submitContingencyPreClose"
          >
            Confirmar Pre-cierre
          </v-btn>
        </div>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useAuthStore } from '../../../stores/auth'
import { useToast } from '../../../composables/useToast'
import { useSupabase } from '../../../composables/useSupabase'
import { formatMoney } from '../../../utils/format'
import type { CashSession, CashSessionMode } from '../../../types'

definePageMeta({ middleware: ['auth', 'role-cashier'], layout: 'sistema', requiredAccess: 'cash' })
useHead({ title: 'Corte de Caja - Aviva Check' })

const auth = useAuthStore()
const toast = useToast()

const activeTab = ref('current')
const loading = ref(false)
const saving = ref(false)
const warning = ref('')
const historyLoading = ref(false)
const historyWarning = ref('')

const currentSession = ref<CashSession | null>(null)
const pendingSessions = ref<CashSession[]>([])
const openSessions = ref<CashSession[]>([])
const historySessions = ref<CashSession[]>([])
const selectedCashMode = ref<CashSessionMode>('shared')

const contingencyDialog = ref(false)
const contingencySession = ref<CashSession | null>(null)
const contingencyCashCounted = ref('0')
const contingencyNotes = ref('')

const cashCountedInput = ref('0')
const notes = ref('')

const ordersCount = ref(0)
const salesTotal = ref(0)
const cashSales = ref(0)
const cardSales = ref(0)
const transferSales = ref(0)

const expectedCash = computed(() => Number(currentSession.value?.opening_cash || 0) + cashSales.value)
const cashCounted = computed(() => Number(cashCountedInput.value || 0))
const canApprove = computed(() => ['leader', 'pastor', 'super_admin'].includes(auth.role || ''))
const cashModeOptions = computed(() => {
  const options = [
    { value: 'shared' as CashSessionMode, label: 'Caja general', icon: 'mdi-cash-register' },
  ]

  if (auth.profile?.role === 'cashier' && auth.profile?.independent_cash_register) {
    options.push({ value: 'independent' as CashSessionMode, label: 'Caja independiente', icon: 'mdi-safe' })
  }

  return options
})
const canPreClose = computed(() => {
  if (saving.value) return false
  if (!currentSession.value || currentSession.value.status !== 'open') return false
  return Number.isFinite(cashCounted.value) && cashCounted.value >= 0
})

onMounted(async () => {
  await auth.init()
  selectedCashMode.value = auth.profile?.role === 'cashier' && auth.profile?.independent_cash_register ? 'independent' : 'shared'
  await loadAll()
})

watch(activeTab, async (tab) => {
  if (tab === 'history') await loadHistory()
})

function getSupabase() {
  try { return useSupabase() } catch { return null }
}

function normalizeSession(raw: any): CashSession {
  return {
    ...raw,
    opening_cash: Number(raw.opening_cash ?? 0),
    cash_counted: raw.cash_counted == null ? null : Number(raw.cash_counted),
    expected_cash: raw.expected_cash == null ? null : Number(raw.expected_cash),
    sales_total: Number(raw.sales_total ?? 0),
    total_cash_sales: Number(raw.total_cash_sales ?? 0),
    total_card_sales: Number(raw.total_card_sales ?? 0),
    total_transfer_sales: Number(raw.total_transfer_sales ?? 0),
    orders_count: Number(raw.orders_count ?? 0),
    difference: raw.difference == null ? null : Number(raw.difference),
  } as CashSession
}

function currentDepartmentOwnerId() {
  const profile = auth.profile
  if (!profile) return null
  if (profile.role === 'pastor' || profile.role === 'leader' || profile.role === 'super_admin') return profile.id
  return profile.owner_id || null
}

function money(amount: number) {
  return formatMoney(amount || 0)
}

function modeLabel(mode: string) {
  return mode === 'independent' ? 'Caja independiente' : 'Caja compartida'
}

function statusLabel(status: string) {
  if (status === 'open') return 'Abierta'
  if (status === 'pending_validation') return 'Pendiente de validacion'
  if (status === 'closed') return 'Cerrada'
  return status
}

function formatDateTime(value?: string | null) {
  if (!value) return '-'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '-'
  return d.toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })
}

function goToPos() {
  navigateTo('/page/POS/pointOfSales')
}

async function loadAll() {
  await loadCurrentSession()
  await loadPendingSessions()
  await loadOpenSessions()
}

async function loadCurrentSession() {
  warning.value = ''
  loading.value = true
  const sb = getSupabase()

  if (!sb?.rpc) {
    warning.value = 'Supabase no detectado.'
    loading.value = false
    return
  }

  try {
    const { data, error } = await sb.rpc('get_current_cash_session', {
      p_mode: selectedCashMode.value,
    })
    if (error) throw error

    currentSession.value = data?.session ? normalizeSession(data.session) : null
    await loadSessionPreview()
  } catch (e: any) {
    warning.value = e?.message ?? String(e)
  } finally {
    loading.value = false
  }
}

async function selectCashMode(mode: CashSessionMode | null) {
  if (!mode || mode === selectedCashMode.value) return
  selectedCashMode.value = mode
  warning.value = ''
  await loadAll()
}

async function loadSessionPreview() {
  ordersCount.value = 0
  salesTotal.value = 0
  cashSales.value = 0
  cardSales.value = 0
  transferSales.value = 0

  const session = currentSession.value
  if (!session) return

  if (session.status !== 'open') {
    ordersCount.value = session.orders_count
    salesTotal.value = session.sales_total
    cashSales.value = session.total_cash_sales
    cardSales.value = session.total_card_sales
    transferSales.value = session.total_transfer_sales
    cashCountedInput.value = String(session.cash_counted ?? 0)
    return
  }

  const sb = getSupabase()
  if (!sb?.from) return

  const { data, error } = await sb
    .from('orders')
    .select('total,payment_method')
    .eq('cash_session_id', session.id)
    .eq('financial_status', 'paid')
    .limit(5000)

  if (error) throw error

  const rows = data ?? []
  ordersCount.value = rows.length
  salesTotal.value = rows.reduce((sum: number, row: any) => sum + Number(row.total ?? 0), 0)
  cashSales.value = rows
    .filter((row: any) => row.payment_method === 'cash' || !row.payment_method)
    .reduce((sum: number, row: any) => sum + Number(row.total ?? 0), 0)
  cardSales.value = rows
    .filter((row: any) => row.payment_method === 'card')
    .reduce((sum: number, row: any) => sum + Number(row.total ?? 0), 0)
  transferSales.value = rows
    .filter((row: any) => row.payment_method === 'transfer')
    .reduce((sum: number, row: any) => sum + Number(row.total ?? 0), 0)
}

async function loadPendingSessions() {
  pendingSessions.value = []
  if (!canApprove.value) return

  const sb = getSupabase()
  if (!sb?.from) return

  let query = sb
    .from('cash_sessions')
    .select('*')
    .eq('status', 'pending_validation')
    .order('preclosed_at', { ascending: false })

  if (auth.role === 'leader') {
    const deptOwnerId = currentDepartmentOwnerId()
    if (deptOwnerId) query = query.eq('department_owner_id', deptOwnerId)
  } else if (auth.profile?.org_id && auth.role !== 'super_admin') {
    query = query.eq('org_id', auth.profile.org_id)
  }

  const { data, error } = await query.limit(50)
  if (error) {
    warning.value = error.message
    return
  }

  pendingSessions.value = (data ?? []).map(normalizeSession)
}

async function loadOpenSessions() {
  openSessions.value = []
  if (!canApprove.value) return

  const sb = getSupabase()
  if (!sb?.from) return

  let query = sb
    .from('cash_sessions')
    .select('*')
    .eq('status', 'open')
    .order('opened_at', { ascending: false })

  if (auth.role === 'leader') {
    const deptOwnerId = currentDepartmentOwnerId()
    if (deptOwnerId) query = query.eq('department_owner_id', deptOwnerId)
  } else if (auth.profile?.org_id && auth.role !== 'super_admin') {
    query = query.eq('org_id', auth.profile.org_id)
  }

  const { data, error } = await query.limit(50)
  if (error) {
    warning.value = error.message
    return
  }

  const allOpen = (data ?? []).map(normalizeSession)
  openSessions.value = allOpen.filter(s => !currentSession.value || s.id !== currentSession.value.id)
}

function openContingencyModal(session: CashSession) {
  contingencySession.value = session
  contingencyCashCounted.value = String(Number(session.opening_cash || 0) + Number(session.sales_total || 0))
  contingencyNotes.value = 'Pre-cierre de contingencia por Liderazgo (cajero offline o retirado)'
  contingencyDialog.value = true
}

async function submitContingencyPreClose() {
  const session = contingencySession.value
  if (!session) return

  const sb = getSupabase()
  if (!sb?.rpc) return

  saving.value = true
  try {
    const { data, error } = await sb.rpc('pre_close_cash_session', {
      p_session_id: session.id,
      p_cash_counted: Number(contingencyCashCounted.value || 0),
      p_notes: contingencyNotes.value.trim() || 'Pre-cierre de contingencia por Liderazgo',
    })
    if (error) throw error

    toast.success('Sesión pre-cerrada exitosamente (Contingencia)')
    contingencyDialog.value = false
    await loadAll()
  } catch (e: any) {
    const msg = e?.message || ''
    toast.error('Error en contingencia: ' + (msg.startsWith('ACV_') ? 'Operación no permitida.' : (msg || 'Error inesperado.')))
  } finally {
    saving.value = false
  }
}

async function preCloseCurrentSession() {
  const session = currentSession.value
  if (!session) return

  const sb = getSupabase()
  if (!sb?.rpc) return

  saving.value = true
  try {
    const { data, error } = await sb.rpc('pre_close_cash_session', {
      p_session_id: session.id,
      p_cash_counted: cashCounted.value,
      p_notes: notes.value.trim() || null,
    })
    if (error) throw error

    currentSession.value = data?.session ? normalizeSession(data.session) : currentSession.value
    toast.success('Caja enviada a validacion')
    await loadAll()
  } catch (e: any) {
    const msg = e?.message || ''
    toast.error('Error al pre-cerrar: ' + (msg.startsWith('ACV_') ? 'Operación no permitida.' : (msg || 'Error inesperado.')))
  } finally {
    saving.value = false
  }
}

async function approveSession(sessionId: string) {
  const sb = getSupabase()
  if (!sb?.rpc) return

  saving.value = true
  try {
    const { error } = await sb.rpc('approve_cash_session', {
      p_session_id: sessionId,
      p_notes: null,
    })
    if (error) throw error

    toast.success('Cierre aprobado')
    await loadAll()
    await loadHistory()
  } catch (e: any) {
    const msg = e?.message || ''
    toast.error('Error al aprobar: ' + (msg.startsWith('ACV_') ? 'Operación no permitida.' : (msg || 'Error inesperado.')))
  } finally {
    saving.value = false
  }
}

async function loadHistory() {
  historyWarning.value = ''
  historyLoading.value = true
  const sb = getSupabase()

  if (!sb?.from) {
    historyWarning.value = 'Supabase no detectado.'
    historyLoading.value = false
    return
  }

  try {
    let query = sb
      .from('cash_sessions')
      .select('*')
      .eq('status', 'closed')
      .order('closed_at', { ascending: false })

    if (auth.role === 'leader') {
      const deptOwnerId = currentDepartmentOwnerId()
      if (deptOwnerId) query = query.eq('department_owner_id', deptOwnerId)
    } else if (auth.role !== 'pastor' && auth.role !== 'super_admin') {
      const deptOwnerId = currentDepartmentOwnerId()
      if (deptOwnerId) query = query.eq('department_owner_id', deptOwnerId)
    } else if (auth.profile?.org_id && auth.role !== 'super_admin') {
      query = query.eq('org_id', auth.profile.org_id)
    }

    const { data, error } = await query.limit(100)
    if (error) throw error
    historySessions.value = (data ?? []).map(normalizeSession)
  } catch (e: any) {
    historyWarning.value = e?.message ?? String(e)
  } finally {
    historyLoading.value = false
  }
}
</script>
