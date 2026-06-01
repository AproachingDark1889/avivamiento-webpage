import { createClient } from '@supabase/supabase-js'

export default defineNuxtPlugin((nuxtApp) => {
    const config = useRuntimeConfig()

    const url = config.public?.supabaseUrl || import.meta.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
    const key = config.public?.supabaseKey || import.meta.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY

    if (!url || !key) {
        console.warn('[AvivaCheck] Supabase URL/KEY no detectadas. El cliente no se iniciará.')
        return
    }

    const supabase = createClient(url as string, key as string, {
        auth: {
            storage: typeof window !== 'undefined' ? window.sessionStorage : undefined,
            persistSession: true,
            autoRefreshToken: true,
        }
    })
    nuxtApp.provide('supabase', supabase)
})