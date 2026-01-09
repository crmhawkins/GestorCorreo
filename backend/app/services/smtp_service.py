"""
SMTP service for sending emails.
"""
import aiosmtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.base import MIMEBase
from email import encoders
import os
from typing import List, Optional


class SMTPService:
    """Service for sending emails via SMTP."""
    
    def __init__(self, host: str, port: int, username: str, password: str):
        self.host = host
        self.port = port
        self.username = username
        self.password = password
    
    async def send_email(
        self,
        to_addresses: List[str],
        subject: str,
        body_text: Optional[str] = None,
        body_html: Optional[str] = None,
        cc_addresses: Optional[List[str]] = None,
        bcc_addresses: Optional[List[str]] = None,
        attachments: Optional[List[dict]] = None
    ) -> dict:
        """
        Send an email with optional attachments.
        
        Args:
            to_addresses: List of recipient email addresses
            subject: Email subject
            body_text: Plain text body
            body_html: HTML body
            cc_addresses: CC recipients
            bcc_addresses: BCC recipients
            attachments: List of dicts with 'filename' and 'content' (bytes)
        
        Returns:
            dict with status and message
        """
        try:
            # Create message
            msg = MIMEMultipart('alternative')
            msg['From'] = self.username
            msg['To'] = ', '.join(to_addresses)
            msg['Subject'] = subject
            
            if cc_addresses:
                msg['Cc'] = ', '.join(cc_addresses)
            
            # Add body
            if body_text:
                msg.attach(MIMEText(body_text, 'plain'))
            if body_html:
                msg.attach(MIMEText(body_html, 'html'))
            
            # Add attachments
            if attachments:
                for attachment in attachments:
                    part = MIMEBase('application', 'octet-stream')
                    part.set_payload(attachment['content'])
                    encoders.encode_base64(part)
                    part.add_header(
                        'Content-Disposition',
                        f'attachment; filename= {attachment["filename"]}'
                    )
                    msg.attach(part)
            
            # Combine all recipients
            all_recipients = to_addresses.copy()
            if cc_addresses:
                all_recipients.extend(cc_addresses)
            if bcc_addresses:
                all_recipients.extend(bcc_addresses)
            
            # Send email
            async with aiosmtplib.SMTP(hostname=self.host, port=self.port) as smtp:
                await smtp.starttls()
                await smtp.login(self.username, self.password)
                await smtp.send_message(msg, recipients=all_recipients)
            
            return {
                "status": "success",
                "message": f"Email sent to {len(all_recipients)} recipients"
            }
            
        except Exception as e:
            return {
                "status": "error",
                "message": str(e)
            }
