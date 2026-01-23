// app/plugins/auth-init.client.ts
import { useAuthStore } from '../stores/auth'

export default defineNuxtPlugin(async () => {
    const auth = useAuthStore()
    await auth.init()
    auth.bindAuthListener()
})
