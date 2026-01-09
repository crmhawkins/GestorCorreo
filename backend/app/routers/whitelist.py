"""
Router for whitelist management.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import List

from app.database import get_db
from app.models import ServiceWhitelist


router = APIRouter()


class WhitelistCreate(BaseModel):
    """Schema for creating whitelist entry."""
    domain_pattern: str
    description: str = ""


class WhitelistResponse(BaseModel):
    """Schema for whitelist response."""
    id: int
    domain_pattern: str
    description: str
    is_active: bool
    
    class Config:
        from_attributes = True


@router.get("/", response_model=List[WhitelistResponse])
async def list_whitelist(db: AsyncSession = Depends(get_db)):
    """List all whitelist entries."""
    result = await db.execute(select(ServiceWhitelist))
    entries = result.scalars().all()
    return entries


@router.post("/", response_model=WhitelistResponse, status_code=status.HTTP_201_CREATED)
async def create_whitelist_entry(
    entry_data: WhitelistCreate,
    db: AsyncSession = Depends(get_db)
):
    """Add domain to whitelist."""
    # Check if already exists
    result = await db.execute(
        select(ServiceWhitelist).where(
            ServiceWhitelist.domain_pattern == entry_data.domain_pattern
        )
    )
    existing = result.scalar_one_or_none()
    
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Domain pattern already in whitelist"
        )
    
    entry = ServiceWhitelist(
        domain_pattern=entry_data.domain_pattern,
        description=entry_data.description,
        is_active=True
    )
    
    db.add(entry)
    await db.commit()
    await db.refresh(entry)
    
    return entry


@router.delete("/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_whitelist_entry(
    entry_id: int,
    db: AsyncSession = Depends(get_db)
):
    """Remove domain from whitelist."""
    result = await db.execute(
        select(ServiceWhitelist).where(ServiceWhitelist.id == entry_id)
    )
    entry = result.scalar_one_or_none()
    
    if not entry:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Whitelist entry not found"
        )
    
    await db.delete(entry)
    await db.commit()
    
    return None


@router.patch("/{entry_id}/toggle")
async def toggle_whitelist_entry(
    entry_id: int,
    db: AsyncSession = Depends(get_db)
):
    """Toggle active status of whitelist entry."""
    result = await db.execute(
        select(ServiceWhitelist).where(ServiceWhitelist.id == entry_id)
    )
    entry = result.scalar_one_or_none()
    
    if not entry:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Whitelist entry not found"
        )
    
    entry.is_active = not entry.is_active
    await db.commit()
    await db.refresh(entry)
    
    return {
        "id": entry.id,
        "domain_pattern": entry.domain_pattern,
        "is_active": entry.is_active
    }
