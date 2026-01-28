/**
 * AccountManager component - modal for adding email accounts
 */
import { useState } from 'react'
import { useCreateAccount } from '../hooks/useApi'
import { useToast } from '../hooks/useToast'
import type { AccountCreate } from '../services/api'
import './AccountManager.css'

interface AccountManagerProps {
    onClose: () => void
}

export default function AccountManager({ onClose }: AccountManagerProps) {
    const createAccount = useCreateAccount()
    const { showSuccess, showError } = useToast()

    const [formData, setFormData] = useState<AccountCreate>({
        email_address: '',
        imap_host: 'pop.ionos.es',
        imap_port: 995,
        smtp_host: 'smtp.ionos.es',
        smtp_port: 587,
        username: '',
        password: '',
        protocol: 'pop3',
    })

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()

        try {
            await createAccount.mutateAsync(formData)
            showSuccess('Account added successfully!')
            onClose()
        } catch (error: any) {
            const errorMsg = error?.response?.data?.detail || 'Failed to create account'
            showError(errorMsg)
            console.error('Error creating account:', error)
        }
    }

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target
        setFormData(prev => ({
            ...prev,
            [name]: name.includes('port') ? parseInt(value) || 0 : value
        }))
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Add Email Account</h2>
                    <button className="close-btn" onClick={onClose}>×</button>
                </div>

                <form onSubmit={handleSubmit} className="account-form">
                    <div className="form-group">
                        <label>Email Address</label>
                        <input
                            type="email"
                            name="email_address"
                            value={formData.email_address}
                            onChange={handleChange}
                            required
                            placeholder="your@email.com"
                        />
                    </div>

                    <div className="form-group">
                        <label>Protocol</label>
                        <select
                            name="protocol"
                            value={formData.protocol || 'pop3'}
                            onChange={e => setFormData(prev => ({ ...prev, protocol: e.target.value as 'imap' | 'pop3' }))}
                            style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ddd' }}
                        >
                            <option value="pop3">POP3</option>
                            <option value="imap">IMAP</option>
                        </select>
                    </div>

                    <div className="form-group">
                        <label>Username</label>
                        <input
                            type="text"
                            name="username"
                            value={formData.username}
                            onChange={handleChange}
                            required
                            placeholder="Usually same as email"
                        />
                    </div>

                    <div className="form-group">
                        <label>Password</label>
                        <input
                            type="password"
                            name="password"
                            value={formData.password}
                            onChange={handleChange}
                            required
                        />
                    </div>

                    <div className="form-row">
                        <div className="form-group">
                            <label>POP/IMAP Host</label>
                            <input
                                type="text"
                                name="imap_host"
                                value={formData.imap_host}
                                onChange={handleChange}
                                required
                                placeholder="pop.ionos.es or imap.ionos.es"
                            />
                        </div>
                        <div className="form-group">
                            <label>POP/IMAP Port</label>
                            <input
                                type="number"
                                name="imap_port"
                                value={formData.imap_port}
                                onChange={handleChange}
                                required
                                placeholder="995 (POP) or 993 (IMAP)"
                            />
                        </div>
                    </div>

                    <div className="form-row">
                        <div className="form-group">
                            <label>SMTP Host</label>
                            <input
                                type="text"
                                name="smtp_host"
                                value={formData.smtp_host}
                                onChange={handleChange}
                                required
                                placeholder="smtp.gmail.com"
                            />
                        </div>
                        <div className="form-group">
                            <label>SMTP Port</label>
                            <input
                                type="number"
                                name="smtp_port"
                                value={formData.smtp_port}
                                onChange={handleChange}
                                required
                            />
                        </div>
                    </div>

                    <div className="form-actions">
                        <button type="button" onClick={onClose} className="btn-secondary">
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="btn-primary"
                            disabled={createAccount.isPending}
                        >
                            {createAccount.isPending ? 'Adding...' : 'Add Account'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    )
}
