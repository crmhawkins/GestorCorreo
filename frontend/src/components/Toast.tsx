/**
 * Toast notification component
 */
import { useEffect } from 'react'
import './Toast.css'

export type ToastType = 'success' | 'error' | 'info' | 'warning'

export interface ToastProps {
    id: string
    type: ToastType
    message: string
    duration?: number
    onClose: (id: string) => void
}

export default function Toast({ id, type, message, duration = 5000, onClose }: ToastProps) {
    useEffect(() => {
        const timer = setTimeout(() => {
            onClose(id)
        }, duration)

        return () => clearTimeout(timer)
    }, [id, duration, onClose])

    const getIcon = () => {
        switch (type) {
            case 'success': return '✓'
            case 'error': return '✕'
            case 'warning': return '⚠'
            case 'info': return 'ℹ'
        }
    }

    return (
        <div className={`toast toast-${type}`} onClick={() => onClose(id)}>
            <span className="toast-icon">{getIcon()}</span>
            <span className="toast-message">{message}</span>
            <button className="toast-close" onClick={() => onClose(id)}>×</button>
        </div>
    )
}
