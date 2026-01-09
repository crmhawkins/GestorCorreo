/**
 * Settings component - manage accounts and test connections
 */
import { useState } from 'react'
import { useAccounts } from '../hooks/useApi'
import { useToast } from '../hooks/useToast'
import axios from 'axios'
import './Settings.css'

interface SettingsProps {
    onClose: () => void
}

export default function Settings({ onClose }: SettingsProps) {
    const { data: accounts, refetch } = useAccounts()
    const { showSuccess, showError, showInfo } = useToast()
    const [testingId, setTestingId] = useState<number | null>(null)

    const handleTestConnection = async (accountId: number) => {
        setTestingId(accountId)
        showInfo('Testing connection...')

        try {
            await axios.post(`http://localhost:8000/api/accounts/${accountId}/test`)
            showSuccess('Connection successful!')
        } catch (error: any) {
            showError(error?.response?.data?.detail || 'Connection failed')
        } finally {
            setTestingId(null)
        }
    }

    const handleDeleteAccount = async (accountId: number, email: string) => {
        if (!confirm(`Delete account ${email}?`)) return

        try {
            await axios.delete(`http://localhost:8000/api/accounts/${accountId}`)
            showSuccess('Account deleted')
            refetch()
        } catch (error: any) {
            showError(error?.response?.data?.detail || 'Failed to delete account')
        }
    }

    return (
        <div className="settings-overlay" onClick={onClose}>
            <div className="settings" onClick={(e) => e.stopPropagation()}>
                <div className="settings-header">
                    <h2>⚙️ Settings</h2>
                    <button className="close-btn" onClick={onClose}>×</button>
                </div>

                <div className="settings-content">
                    <section className="settings-section">
                        <h3>Email Accounts</h3>

                        {!accounts || accounts.length === 0 ? (
                            <p className="empty-message">No accounts configured</p>
                        ) : (
                            <div className="accounts-list">
                                {accounts.map((account) => (
                                    <div key={account.id} className="account-card">
                                        <div className="account-info">
                                            <div className="account-email">
                                                <strong>{account.email_address}</strong>
                                                <span className={`status-badge ${account.is_active ? 'active' : 'inactive'}`}>
                                                    {account.is_active ? '✓ Active' : '✕ Inactive'}
                                                </span>
                                            </div>
                                            <div className="account-details">
                                                <div className="detail-row">
                                                    <span className="label">IMAP:</span>
                                                    <span>{account.imap_host}:{account.imap_port}</span>
                                                </div>
                                                <div className="detail-row">
                                                    <span className="label">SMTP:</span>
                                                    <span>{account.smtp_host}:{account.smtp_port}</span>
                                                </div>
                                                <div className="detail-row">
                                                    <span className="label">Username:</span>
                                                    <span>{account.username}</span>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="account-actions">
                                            <button
                                                className="btn-test"
                                                onClick={() => handleTestConnection(account.id)}
                                                disabled={testingId === account.id}
                                            >
                                                {testingId === account.id ? '⏳ Testing...' : '🔌 Test Connection'}
                                            </button>
                                            <button
                                                className="btn-delete"
                                                onClick={() => handleDeleteAccount(account.id, account.email_address)}
                                            >
                                                🗑️ Delete
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </section>

                    <section className="settings-section">
                        <h3>AI Classification Settings</h3>

                        <div className="ai-config">
                            <div className="config-group">
                                <label className="config-label">Email Categories</label>
                                <p className="config-description">
                                    Define the categories used for email classification. Each category should have a clear purpose.
                                </p>
                                <div className="categories-list">
                                    <div className="category-item">
                                        <span className="category-icon">⭐</span>
                                        <div className="category-info">
                                            <strong>Interesantes</strong>
                                            <p>Emails with real intent to hire Hawkins services (quotes, proposals, business meetings)</p>
                                        </div>
                                    </div>
                                    <div className="category-item">
                                        <span className="category-icon">🚫</span>
                                        <div className="category-info">
                                            <strong>SPAM</strong>
                                            <p>Spam, phishing, unsolicited newsletters, cold outreach trying to sell us something</p>
                                        </div>
                                    </div>
                                    <div className="category-item">
                                        <span className="category-icon">📋</span>
                                        <div className="category-info">
                                            <strong>EnCopia</strong>
                                            <p>Emails with multiple internal @hawkins.es recipients in To or CC (not directed only to me)</p>
                                        </div>
                                    </div>
                                    <div className="category-item">
                                        <span className="category-icon">🔔</span>
                                        <div className="category-info">
                                            <strong>Servicios</strong>
                                            <p>Transactional notifications from known platforms (booking, banks, Amazon, etc.)</p>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="config-group">
                                <label className="config-label">Classification Instructions</label>
                                <p className="config-description">
                                    These instructions guide the AI in classifying emails. The AI uses these rules to determine the category.
                                </p>
                                <div className="instructions-box">
                                    <div className="instruction-item">
                                        <strong>Key Rules:</strong>
                                        <ul>
                                            <li>If the email tries to sell us something → <strong>SPAM</strong></li>
                                            <li>If they request our services → <strong>Interesantes</strong></li>
                                            <li>Multiple internal recipients → <strong>EnCopia</strong></li>
                                            <li>Platform notifications → <strong>Servicios</strong></li>
                                        </ul>
                                    </div>
                                    <div className="instruction-item">
                                        <strong>AI Models Used:</strong>
                                        <ul>
                                            <li><code>gpt-oss:120b-cloud</code> - Primary classification</li>
                                            <li><code>qwen3-coder:480b-cloud</code> - Secondary validation</li>
                                            <li>Consensus or GPT review for final decision</li>
                                        </ul>
                                    </div>
                                </div>
                                <p className="config-note">
                                    ℹ️ <strong>Note:</strong> To modify the AI prompts and categories, edit the <code>ai_service.py</code> file in the backend.
                                </p>
                            </div>
                        </div>
                    </section>
                </div>
            </div>
        </div>
    )
}
