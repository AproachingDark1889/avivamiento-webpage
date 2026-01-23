export const useToast = () => {
    const show = useState<boolean>('toast_show', () => false)
    const message = useState<string>('toast_message', () => '')
    const color = useState<string>('toast_color', () => 'success')

    const success = (msg: string) => {
        message.value = msg
        color.value = 'success'
        show.value = true
    }

    const error = (msg: string) => {
        message.value = msg
        color.value = 'error'
        show.value = true
    }

    const info = (msg: string) => {
        message.value = msg
        color.value = 'info'
        show.value = true
    }

    return { show, message, color, success, error, info }
}
