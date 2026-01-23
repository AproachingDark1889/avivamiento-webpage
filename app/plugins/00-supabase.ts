import { createClient } from '@supabase/supabase-js'

export default defineNuxtPlugin((nuxtApp) => {
    const config = useRuntimeConfig()

    // Intentamos leer de todos lados
    const url = config.public?.supabaseUrl || import.meta.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
    const key = config.public?.supabaseKey || import.meta.env.VITE_SUPABASE_KEY || process.env.SUPABASE_KEY

    // 🕵️‍♂️ EL CHISMOSO: Imprimir en consola qué estamos recibiendo
    console.log('🔍 [GÉNESIS DEBUG] Intentando conectar Supabase...')
    console.log('   -> URL detectada:', url ? '✅ SÍ (' + url.substring(0, 15) + '...)' : '❌ NO DETECTADA (Undefined)')
    console.log('   -> KEY detectada:', key ? '✅ SÍ (' + key.substring(0, 10) + '...)' : '❌ NO DETECTADA (Undefined)')

    if (!url || !key) {
        console.warn('⚠️ GÉNESIS ERROR: Faltan las llaves. El cliente no se iniciará.')
        return
    }

    const supabase = createClient(url as string, key as string)
    nuxtApp.provide('supabase', supabase)
    console.log('🚀 [GÉNESIS SUCCESS] Cliente Supabase inyectado correctamente.')
})