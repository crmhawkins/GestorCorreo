"""
Router for classification endpoints.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List
import json

from app.database import get_db
from app.models import Message, Classification, User, Account
from app.dependencies import get_current_active_user
from app.services.scheduler import run_classification


router = APIRouter()


@router.post("/{message_id}")
async def classify_message(
    message_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """
    Classify a single message using AI + rules.
    
    Returns classification result and saves to database.
    """
    # Get message and its account
    result = await db.execute(
        select(Message, Account)
        .join(Account, Message.account_id == Account.id)
        .where(Message.id == message_id)
    )
    row = result.first()
    
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Message not found"
        )
        
    message, account = row
    
    # Check if already classified
    result = await db.execute(
        select(Classification).where(Classification.message_id == message_id)
    )
    existing = result.scalar_one_or_none()
    
    if existing:
        return {
            "message": "Already classified",
            "classification": {
                "final_label": existing.final_label,
                "decided_by": existing.decided_by
            }
        }
    
    # Run central classification logic
    count = await run_classification(db, account, [message_id])
    
    if count == 0:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Classification failed or skipped"
        )
    
    # Fetch the newly created classification
    result = await db.execute(
        select(Classification).where(Classification.message_id == message_id)
    )
    classification = result.scalar_one_or_none()
    
    if not classification:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve classification result"
        )
    
    return {
        "message": "Classification successful",
        "classification": {
            "final_label": classification.final_label,
            "decided_by": classification.decided_by,
            "gpt_label": classification.gpt_label,
            "qwen_label": classification.qwen_label
        }
    }


@router.post("/batch")
async def classify_batch(
    message_ids: List[str],
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """
    Classify multiple messages in batch.
    """
    if not message_ids:
        return {"total": 0, "results": []}

    # Fetch messages and their accounts
    result = await db.execute(
        select(Message, Account)
        .join(Account, Message.account_id == Account.id)
        .where(Message.id.in_(message_ids))
    )
    rows = result.all()
    
    # Group by account
    accounts_messages = {}
    for msg, acc in rows:
        if acc.id not in accounts_messages:
            accounts_messages[acc.id] = {"account": acc, "message_ids": []}
        accounts_messages[acc.id]["message_ids"].append(msg.id)
        
    total_classified = 0
    results = []
    
    for account_id, data in accounts_messages.items():
        try:
            count = await run_classification(db, data["account"], data["message_ids"])
            total_classified += count
            
            for m_id in data["message_ids"]:
                results.append({
                    "message_id": m_id,
                    "status": "processed via batch"
                })
        except Exception as e:
            for m_id in data["message_ids"]:
                results.append({
                    "message_id": m_id,
                    "status": "error",
                    "error": str(e)
                })
    
    return {
        "status": "success",
        "total": len(message_ids),
        "classified": total_classified,
        "results": results
    }


@router.get("/{message_id}")
async def get_classification(
    message_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get classification for a message."""
    result = await db.execute(
        select(Classification).where(Classification.message_id == message_id)
    )
    classification = result.scalar_one_or_none()
    
    if not classification:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Classification not found"
        )
    
    return {
        "message_id": classification.message_id,
        "final_label": classification.final_label,
        "decided_by": classification.decided_by,
        "gpt_label": classification.gpt_label,
        "gpt_confidence": classification.gpt_confidence,
        "qwen_label": classification.qwen_label,
        "qwen_confidence": classification.qwen_confidence,
        "decided_at": classification.decided_at
    }
