"""
Router for sending emails.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import base64

from app.database import get_db
from app.models import Account
from app.schemas import SendEmailRequest, SendEmailResponse
from app.utils.security import decrypt_password
from app.services.smtp_service import SMTPService


router = APIRouter()


@router.post("/", response_model=SendEmailResponse)
async def send_email(
    email_data: SendEmailRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Send an email via SMTP.
    
    - **account_id**: Account to send from
    - **to**: List of recipient emails
    - **cc**: Optional CC recipients
    - **bcc**: Optional BCC recipients
    - **subject**: Email subject
    - **body_text**: Plain text body
    - **body_html**: HTML body
    - **attachments**: Optional list of attachments (base64 encoded)
    """
    # Get account
    result = await db.execute(
        select(Account).where(Account.id == email_data.account_id)
    )
    account = result.scalar_one_or_none()
    
    if not account:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Account not found"
        )
    
    if not account.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Account is not active"
        )
    
    # Decrypt password
    try:
        password = decrypt_password(account.encrypted_password)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to decrypt password"
        )
    
    # Prepare attachments
    attachments = None
    if email_data.attachments:
        attachments = []
        for att in email_data.attachments:
            try:
                content = base64.b64decode(att.content)
                attachments.append({
                    'filename': att.filename,
                    'content': content
                })
            except Exception as e:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid attachment data: {str(e)}"
                )
    
    # Send email
    smtp = SMTPService(
        host=account.smtp_host,
        port=account.smtp_port,
        username=account.username,
        password=password
    )
    
    result = await smtp.send_email(
        to_addresses=email_data.to,
        subject=email_data.subject,
        body_text=email_data.body_text,
        body_html=email_data.body_html,
        cc_addresses=email_data.cc,
        bcc_addresses=email_data.bcc,
        attachments=attachments
    )
    
    if result["status"] == "error":
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=result["message"]
        )
    
    return SendEmailResponse(**result)
