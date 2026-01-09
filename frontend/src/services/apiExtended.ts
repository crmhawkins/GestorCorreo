/**
 * Extended API client with message body and attachments
 */
import axios from 'axios';

const API_BASE_URL = 'http://localhost:8000';

export const apiClient = axios.create({
    baseURL: API_BASE_URL,
    headers: {
        'Content-Type': 'application/json',
    },
});

// ... (previous code remains the same)

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

export const getAttachmentDownloadUrl = (attachmentId: number): string => {
    return `${API_BASE_URL}/api/attachments/${attachmentId}`;
};

// Export all previous interfaces and functions
export * from './api';
