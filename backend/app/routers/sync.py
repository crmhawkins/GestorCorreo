"""
Router for sync endpoints.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models import Account, AuditLog
from app.schemas import SyncRequest, SyncResponse
from app.utils.security import decrypt_password
from app.services.imap_service import sync_account_messages
import json
from datetime import datetime


router = APIRouter()


@router.post("/start", response_model=SyncResponse)
async def start_sync(
    sync_request: SyncRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Start synchronization for an account.
    
    - **account_id**: ID of the account to sync
    - **folder**: IMAP folder to sync (default: INBOX)
    - **auto_classify**: Automatically classify new messages after sync (default: False)
    """
    # Get account
    result = await db.execute(
        select(Account).where(Account.id == sync_request.account_id)
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
    
    # Perform sync
    sync_result = await sync_account_messages(
        account=account,
        password=password,
        db=db,
        folder=sync_request.folder
    )
    
    # Auto-classify new messages if requested
    classified_count = 0
    if sync_request.auto_classify and sync_result.get("status") == "success" and sync_result.get("new_messages", 0) > 0:
        from app.models import Message, Classification, ServiceWhitelist
        from app.services.rules_engine import classify_with_rules_and_ai
        
        # Get newly synced messages (those without classification)
        result = await db.execute(
            select(Message)
            .outerjoin(Classification, Message.id == Classification.message_id)
            .where(Message.account_id == sync_request.account_id)
            .where(Classification.id == None)
            .order_by(Message.date.desc())
            .limit(20)  # Limit to 20 messages to avoid long sync times
        )
        new_messages = result.scalars().all()
        
        # Get whitelist domains
        result = await db.execute(
            select(ServiceWhitelist).where(ServiceWhitelist.is_active == True)
        )
        whitelist_entries = result.scalars().all()
        whitelist_domains = [entry.domain_pattern for entry in whitelist_entries]
        
        # Classify each new message
        for message in new_messages:
            try:
                message_data = {
                    "from_name": message.from_name,
                    "from_email": message.from_email,
                    "to_addresses": message.to_addresses,
                    "cc_addresses": message.cc_addresses,
                    "subject": message.subject,
                    "date": str(message.date),
                    "body_text": message.body_text,
                    "snippet": message.snippet
                }
                
                classification_result = await classify_with_rules_and_ai(message_data, whitelist_domains)
                
                if classification_result.get("status") != "error":
                    classification = Classification(
                        message_id=message.id,
                        gpt_label=classification_result.get("gpt_label"),
                        gpt_confidence=classification_result.get("gpt_confidence"),
                        gpt_rationale=classification_result.get("gpt_rationale"),
                        qwen_label=classification_result.get("qwen_label"),
                        qwen_confidence=classification_result.get("qwen_confidence"),
                        qwen_rationale=classification_result.get("qwen_rationale"),
                        final_label=classification_result["final_label"],
                        final_reason=classification_result.get("final_reason"),
                        decided_by=classification_result["decided_by"]
                    )
                    db.add(classification)
                    classified_count += 1
            except Exception as e:
                # Log error but continue with other messages
                print(f"Error classifying message {message.id}: {str(e)}")
        
        await db.commit()
    
    # Log the sync operation
    audit_log = AuditLog(
        action="sync",
        payload=json.dumps({
            "account_id": account.id,
            "folder": sync_request.folder,
            "auto_classify": sync_request.auto_classify,
            "result": sync_result,
            "classified_count": classified_count
        }),
        status="success" if sync_result["status"] == "success" else "error",
        error_message=sync_result.get("error")
    )
    db.add(audit_log)
    await db.commit()
    
    # Return result
    if sync_result["status"] == "error":
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=sync_result.get("error", "Sync failed")
        )
    
    return SyncResponse(
        **sync_result,
        classified_count=classified_count
    )


@router.get("/status")
async def get_sync_status(db: AsyncSession = Depends(get_db)):
    """Get status of recent sync operations."""
    result = await db.execute(
        select(AuditLog)
        .where(AuditLog.action == "sync")
        .order_by(AuditLog.timestamp.desc())
        .limit(10)
    )
    logs = result.scalars().all()
    
    return {
        "recent_syncs": [
            {
                "timestamp": log.timestamp,
                "status": log.status,
                "payload": json.loads(log.payload) if log.payload else {},
                "error": log.error_message
            }
            for log in logs
        ]
    }
