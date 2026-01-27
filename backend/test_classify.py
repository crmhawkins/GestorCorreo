import asyncio
from app.database import AsyncSessionLocal
from app.routers.classify import classify_message
from fastapi import HTTPException

# Mock message ID - ensure one exists or create one
from app.models import Message
from sqlalchemy import select

async def test_classify():
    print("Testing classification...")
    async with AsyncSessionLocal() as db:
        # Find a message
        result = await db.execute(select(Message))
        message = result.scalars().first()
        
        if not message:
            print("No messages found in DB to classify.")
            return

        print(f"Classifying message {message.id}...")
        try:
            result = await classify_message(message.id, db)
            print("Classification result:", result)
        except HTTPException as he:
            print(f"HTTPException: {he.status_code} - {he.detail}")
        except Exception as e:
            print(f"Unexpected Error: {e}")
            import traceback
            traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(test_classify())
