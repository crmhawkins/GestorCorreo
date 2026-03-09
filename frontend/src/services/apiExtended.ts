/**
 * Extended API client with message body and attachments
 * Uses the authenticated apiClient from api.ts (includes Bearer token interceptor)
 */
import { apiClient } from './api';



// Message Body
export interface MessageBody {
    body_text?: string;
    body_html?: string;
}

export const getMessageBody = async (messageId: string): Promise<MessageBody> => {
    const response = await apiClient.get(`/api/messages/${messageId}/body`);
    return response.data;
};

// Attachments
export interface Attachment {
    id: number;
    filename: string;
    mime_type?: string;
    size_bytes: number;
}

export const getMessageAttachments = async (messageId: string): Promise<Attachment[]> => {
    const response = await apiClient.get(`/api/attachments/message/${messageId}`);
    return response.data;
};

export const downloadAttachment = async (attachmentId: number, filename: string): Promise<void> => {
    const response = await apiClient.get(`/api/attachments/${attachmentId}`, {
        responseType: 'blob'
    });
    const url = window.URL.createObjectURL(new Blob([response.data]));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
};

// Export all previous interfaces and functions (including getMessage, Message, MessageDetail, etc.)
export * from './api';
