/**
 * Whitelist management component
 */
import { useState, useEffect } from 'react'
import { apiClient } from '../services/api'
import './WhitelistManager.css'

interface WhitelistEntry {
    id: number
    domain_pattern: string
    description: string
    is_active: boolean
}

export default function WhitelistManager() {
    const [entries, setEntries] = useState<WhitelistEntry[]>([])
    const [newDomain, setNewDomain] = useState('')
    const [newDescription, setNewDescription] = useState('')
    const [loading, setLoading] = useState(false)

    const loadWhitelist = async () => {
        try {
            const response = await apiClient.get('/api/whitelist')
            setEntries(response.data)
        } catch (error) {
            console.error('Error loading whitelist:', error)
        }
    }

    const addEntry = async (e: React.FormEvent) => {
        e.preventDefault()
        setLoading(true)

        try {
            await apiClient.post('/api/whitelist', {
                domain_pattern: newDomain,
                description: newDescription
            })

            setNewDomain('')
            setNewDescription('')
            loadWhitelist()
        } catch (error) {
            console.error('Error adding entry:', error)
        } finally {
            setLoading(false)
        }
    }

    const deleteEntry = async (id: number) => {
        if (!confirm('¿Eliminar este dominio de la whitelist?')) return

        try {
            await apiClient.delete(`/api/whitelist/${id}`)
            loadWhitelist()
        } catch (error) {
            console.error('Error deleting entry:', error)
        }
    }

    useEffect(() => {
        loadWhitelist()
    }, [])

    return (
        <div className="whitelist-manager">
            <h2>Whitelist de Servicios</h2>
            <p className="description">
                Dominios que siempre se clasificarán como "Servicios" (notificaciones transaccionales)
            </p>

            <form onSubmit={addEntry} className="add-form">
                <input
                    type="text"
                    placeholder="@booking.com, @*.amazon.*, etc."
                    value={newDomain}
                    onChange={(e) => setNewDomain(e.target.value)}
                    required
                />
                <input
                    type="text"
                    placeholder="Descripción (opcional)"
                    value={newDescription}
                    onChange={(e) => setNewDescription(e.target.value)}
                />
                <button type="submit" disabled={loading} className="btn-primary">
                    {loading ? 'Añadiendo...' : '+ Añadir'}
                </button>
            </form>

            <div className="entries-list">
                {entries.length === 0 ? (
                    <p className="empty">No hay dominios en la whitelist</p>
                ) : (
                    entries.map((entry) => (
                        <div key={entry.id} className="entry-item">
                            <div className="entry-info">
                                <strong>{entry.domain_pattern}</strong>
                                {entry.description && <span className="desc">{entry.description}</span>}
                            </div>
                            <button
                                onClick={() => deleteEntry(entry.id)}
                                className="btn-delete"
                            >
                                ×
                            </button>
                        </div>
                    ))
                )}
            </div>
        </div>
    )
}
