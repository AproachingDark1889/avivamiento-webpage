<template>
  <div class="pa-4 h-100 d-flex flex-column">
    <div class="d-flex align-center mb-4">
      <h1 class="text-h4 font-weight-black text-primary">
        <v-icon start size="36">mdi-cash-register</v-icon>Corte de Caja
      </h1>
      <v-spacer />
      <v-chip color="secondary" variant="flat" class="font-weight-bold ml-2">Cashier / Leader / Admin</v-chip>
    </div>

    <v-card elevation="2" class="pa-4 flex-grow-1 overflow-y-auto" rounded="xl" border>
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

            <v-divider class="my-6" />

            <v-btn
              color="success"
              block
              size="large"
              :loading="saving"
              :disabled="!canSave"
              @click="saveClosure"
              rounded="lg"
              class="font-weight-bold text-h6"
            >
              <v-icon start>mdi-content-save-check</v-icon>
              Guardar cierre
            </v-btn>

            <div class="mt-4 text-center text-caption text-medium-emphasis">
              Guarda en tabla <code>cash_closures</code>. Requiere RLS para que solo roles autorizados inserten.
            </div>
    </v-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useToast } from '../../composables/useToast'

definePageMeta({ middleware: ['auth', 'role-cashier'], layout: 'sistema' })
useHead({ title: 'Corte de Caja - Aviva Check' })

const toast = useToast()
const loading = ref(false)
const saving = ref(false)
const warning = ref('')

const date = ref('')

const openingCashInput = ref<string>('0')
const cashCountedInput = ref<string>('0')

const salesTotal = ref(0)

function todayISO() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

onMounted(() => {
  date.value = todayISO()
  calculate()
})

function money(amount: number) {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(amount || 0)
}

function num(v: string) {
  const n = Number(v || 0)
  return Number.isFinite(n) ? n : 0
}

const openingCash = computed(() => num(openingCashInput.value))
const cashCounted = computed(() => num(cashCountedInput.value))
const expectedCash = computed(() => openingCash.value + salesTotal.value)
const difference = computed(() => cashCounted.value - expectedCash.value)

const canSave = computed(() => {
  if (saving.value) return false
  if (!date.value) return false
  return true
})

function getSupabase(): any | null {
  const nuxtApp = useNuxtApp() as any
  return nuxtApp?.$supabase || nuxtApp?.$supabaseClient || null
}

function dayRangeISO(d: string) {
  const start = new Date(`${d}T00:00:00`)
  const end = new Date(`${d}T23:59:59.999`)
  return { startISO: start.toISOString(), endISO: end.toISOString() }
}

async function calculate() {
  warning.value = ''
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

    const { data, error } = await sb
      .from('orders')
      .select('total')
      .gte('created_at', startISO)
      .lte('created_at', endISO)
      .limit(5000)

    if (error) throw error

    const rows = data ?? []
    salesTotal.value = rows.reduce((sum: number, r: any) => sum + Number(r.total ?? 0), 0)
  } catch (e: any) {
    warning.value = `Error: ${e?.message ?? String(e)}`
  } finally {
    loading.value = false
  }
}

async function saveClosure() {
  const sb = getSupabase()
  if (!sb?.from) {
    toast.error('Supabase no detectado. No se puede guardar.')
    return
  }

  saving.value = true
  try {
    const payload = {
      date: date.value,
      opening_cash: openingCash.value,
      sales_total: salesTotal.value,
      cash_counted: cashCounted.value,
      expected_cash: expectedCash.value,
      difference: difference.value,
    }

    const { error } = await sb.from('cash_closures').insert(payload)
    if (error) throw error

    toast.success('Cierre guardado correctamente')
  } catch (e: any) {
    toast.error(`Error: ${e?.message ?? String(e)}`)
  } finally {
    saving.value = false
  }
}
</script>
