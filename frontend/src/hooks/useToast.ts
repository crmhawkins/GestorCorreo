/**
 * Custom hook for managing toast notifications
 */
import { useState, useCallback } from 'react'
import type { ToastType } from '../components/Toast'

export interface Toast {
    id: string
    type: ToastType
    message: string
}

export const useToast = () => {
    const [toasts, setToasts] = useState<Toast[]>([])

    const showToast = useCallback((type: ToastType, message: string) => {
        const id = Date.now().toString() + Math.random().toString(36).substr(2, 9)
        setToasts(prev => [...prev, { id, type, message }])
    }, [])

    const removeToast = useCallback((id: string) => {
        setToasts(prev => prev.filter(toast => toast.id !== id))
    }, [])

    const showSuccess = useCallback((message: string) => {
        showToast('success', message)
    }, [showToast])

    const showError = useCallback((message: string) => {
        showToast('error', message)
    }, [showToast])

    const showInfo = useCallback((message: string) => {
        showToast('info', message)
    }, [showToast])

    const showWarning = useCallback((message: string) => {
        showToast('warning', message)
    }, [showToast])

    return {
        toasts,
        removeToast,
        showSuccess,
        showError,
        showInfo,
        showWarning
    }
}
