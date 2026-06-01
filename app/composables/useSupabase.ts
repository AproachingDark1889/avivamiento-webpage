// app/composables/useSupabase.ts
// Composable centralizado para acceder al cliente Supabase.
// Reemplaza las funciones getSupabase() duplicadas en stores y páginas.

export function useSupabase() {
  const nuxtApp = useNuxtApp() as any
  const client = nuxtApp?.$supabase || nuxtApp?.$supabaseClient || null
  if (!client) {
    throw new Error('Supabase client no disponible. Verifica el plugin 00-supabase.ts')
  }
  return client
}
