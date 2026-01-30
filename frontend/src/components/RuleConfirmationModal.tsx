/**
 * Rule Confirmation Modal
 * Prompts user to create a sender rule when moving an email
 */
import './Modal.css'

interface RuleConfirmationModalProps {
    senderEmail: string
    targetFolder: string
    onConfirm: () => void
    onCancel: () => void
}

export default function RuleConfirmationModal({
    senderEmail,
    targetFolder,
    onConfirm,
    onCancel
}: RuleConfirmationModalProps) {
    return (
        <div className="modal-overlay" onClick={onCancel}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h3>📋 Crear Regla</h3>
                    <button className="close-btn" onClick={onCancel}>×</button>
                </div>

                <div className="modal-body">
                    <p>
                        ¿Deseas mover siempre los correos de <strong>{senderEmail}</strong> a la carpeta <strong>{targetFolder}</strong>?
                    </p>
                    <p className="hint">
                        Esto creará una regla automática para futuros mensajes.
                    </p>
                </div>

                <div className="modal-footer">
                    <button onClick={onCancel} className="btn-secondary">
                        No, solo esta vez
                    </button>
                    <button onClick={onConfirm} className="btn-primary">
                        Sí, crear regla
                    </button>
                </div>
            </div>
        </div>
    )
}
